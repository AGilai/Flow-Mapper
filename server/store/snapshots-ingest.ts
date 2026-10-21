// Manifest ingest: full and delta, single and batch, with dry-run. One transaction per call.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { LISTS, keyOf, validateManifest } from '../schema.ts';
import { buildIndex } from '../../core/graph-index.ts';
import { contractReport } from '../../core/contract.ts';
import { HttpError, conflict, invalid, notFound } from '../errors.ts';
import { getSnapshotRow, loadEntities, loadModel, rowToService, type Entities, type Source, type WriteResult } from './snapshots-read.ts';
import { ensureEnv, guardEnv } from './envs.ts';
import { manifestIngested } from '../events/emitters.ts';
import { assertIntegrity, diff, replaceEntities, upsertSnapshot, writeChangelog } from './snapshots-write.ts';

/** Thrown at the end of a dry run so the transaction rolls back; carries the results. */
class DryRun extends Error {
  results: WriteResult[];
  constructor(results: WriteResult[]) { super('dry run'); this.results = results; }
}

/** Ingest one manifest. With dryRun, everything runs (validation, version checks, diff) and is rolled back. */
export function ingest(db: DB, manifest: any, source: Source = 'api', opts: { dryRun?: boolean } = {}): WriteResult {
  return ingestBatch(db, [manifest], source, opts)[0];
}

/**
 * Ingest several manifests in ONE transaction: all or nothing (any invalid or stale manifest rejects the
 * whole batch). Each result's contract report is computed after all are applied, against the final env.
 */
export function ingestBatch(db: DB, manifests: any[], source: Source = 'api', { dryRun = false } = {}): WriteResult[] {
  try {
    const results = tx(db, () => {
      const applied = manifests.map((m, i) => applyIn(db, m, source, manifests.length > 1 ? i : null));
      const index = new Map<string, ReturnType<typeof buildIndex>>();
      const results = applied.map(({ result, after }) => {
        if (!index.has(result.env)) index.set(result.env, buildIndex(loadModel(db, result.env)));
        return { ...result, contract: contractReport({ service: result.service, ...after }, index.get(result.env)!) };
      });
      if (dryRun) throw new DryRun(results); // tx rolls back
      return results;
    });
    if (!dryRun) results.forEach((r, i) => manifestIngested(db, r, manifests[i], source));
    return results;
  } catch (err) {
    if (err instanceof DryRun) return err.results;
    throw err;
  }
}

/** In a real batch, say which manifest failed: message prefix plus details {batchIndex, service, ...}. */
function applyIn(db: DB, manifest: any, source: Source, index: number | null) {
  try {
    return apply(db, manifest, source);
  } catch (err) {
    if (index === null || !(err instanceof HttpError)) throw err;
    const service = typeof manifest?.service?.name === 'string' ? manifest.service.name : null;
    const d = err.details;
    const details = Array.isArray(d) ? { errors: d } : (d as object | undefined);
    throw new HttpError(err.status, err.code, `manifests[${index}] (${service ?? 'unnamed service'}): ${err.message}`, { batchIndex: index, service, ...details });
  }
}

function apply(db: DB, manifest: any, source: Source): { result: WriteResult; after: Entities } {
  const errs = validateManifest(manifest);
  if (errs.length) throw invalid('manifest does not match schema', errs.slice(0, 50));
  const env = manifest.env ?? 'default';
  const name = manifest.service.name;
  guardEnv(db, env, 'harvester');
  ensureEnv(db, env);

  const cur = getSnapshotRow(db, env, name);
  if (cur && manifest.version <= cur.version)
    throw conflict('VERSION_NOT_NEWER', `version ${manifest.version} is not newer than current ${cur.version}`, { currentVersion: cur.version });
  const before = cur ? loadEntities(db, env, name) : {};
  let after: Entities;
  let header = manifest.service;

  if (manifest.kind === 'full') {
    after = Object.fromEntries(LISTS.map((l) => [l, manifest[l] ?? []]));
  } else {
    if (!cur) throw notFound(`service '${name}' in env '${env}' (send a full manifest first)`);
    if (cur.version !== manifest.baseVersion)
      throw conflict('VERSION_MISMATCH', `delta base ${manifest.baseVersion} does not match current ${cur.version}; send a full manifest`, { currentVersion: cur.version });
    header = { ...rowToService(cur), ...manifest.service };
    delete header.version; delete header.harvestedAt; delete header.commit;
    after = {};
    for (const l of LISTS) {
      const del = new Set(manifest.delete?.[l] ?? []);
      const map = new Map(((before as any)[l] ?? []).filter((e: any) => !del.has(keyOf(l, e))).map((e: any) => [keyOf(l, e), e]));
      for (const u of manifest.upsert?.[l] ?? []) map.set(keyOf(l, u), u);
      after[l] = [...map.values()];
    }
  }
  assertIntegrity(name, after);
  const changes = diff(before, after);
  upsertSnapshot(db, env, header, manifest.version, manifest.harvestedAt, manifest.commit);
  replaceEntities(db, env, name, after);
  const changelogId = writeChangelog(db, env, name, cur?.version ?? null, manifest.version, manifest.kind, source, changes);
  return { result: { env, service: name, fromVersion: cur?.version ?? null, toVersion: manifest.version, changes, changelogId }, after };
}
