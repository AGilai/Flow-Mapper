// Manifest ingest: full and delta, single and batch, with dry-run. One transaction per call.
// `ingestIn` is the body without the transaction: harvesters reach it through ingestBatch, a draft's apply calls it directly.

import { resolveOwners, resolveAbout } from './owners.ts';
import type { DB } from '../db/connection.ts';
import { LISTS, keyOf, validateManifest } from '../schema.ts';
import { buildIndex, type GraphIndex } from '../../core/graph-index.ts';
import { contractReport } from '../../core/contract.ts';
import { HttpError, conflict, invalid, notFound } from '../errors.ts';
import { getSnapshotRow, loadEntities, loadModel, rowToService, type Entities, type Source, type WriteResult } from './snapshots-read.ts';
import { ensureEnv, guardEnv, type Writer } from './envs.ts';
import { assignColorsIn } from './colors.ts';
import { manifestsIngested } from '../events/emitters.ts';
import { assertIntegrity, diff, replaceEntities, upsertSnapshot, writeChangelog } from './snapshots-write.ts';
import { withDry } from './dry-run.ts';

/** How a batch is applied. `writer` picks the guard; the rest is for a draft's apply (see draft-apply.ts). */
export interface ApplyOpts {
  writer: Writer;
  /** Problems a service already had (a copied component's dangling handlers) do not block a change that does not cause them. */
  tolerateExisting?: boolean;
  /** Services whose header is replaced by the manifest's, not merged into the stored one (a removed header field goes). */
  replaceHeader?: Set<string>;
  /** Written on the changelog rows. */
  draftId?: number;
  /** Filled with the graph of each env after the batch (built once for the contract reports), for the caller to hand to the graph cache after the commit. */
  graphs?: Map<string, GraphIndex>;
}

/** Ingest one manifest. With dryRun, everything runs (validation, version checks, diff) and is rolled back. */
export function ingest(db: DB, manifest: any, source: Source = 'api', opts: { dryRun?: boolean } = {}): WriteResult {
  return ingestBatch(db, [manifest], source, opts)[0];
}

/**
 * Ingest several manifests in ONE transaction: all or nothing (any invalid or stale manifest rejects the
 * whole batch). Each result's contract report is computed after all are applied, against the final env.
 * A dry run may target a design environment (nothing is written); `prelude` runs first inside the same transaction
 * (the draft apply of `?draft=`, so the batch is checked against the environment as that draft leaves it).
 */
export function ingestBatch(db: DB, manifests: any[], source: Source = 'api', { dryRun = false, prelude, graphs }: { dryRun?: boolean; prelude?: () => void; graphs?: Map<string, GraphIndex> } = {}): WriteResult[] {
  const results = withDry(db, dryRun, () => {
    prelude?.();
    return ingestIn(db, manifests, source, { writer: dryRun ? 'dry' : 'harvester', graphs: dryRun ? undefined : graphs });
  });
  if (!dryRun) manifestsIngested(db, results, manifests, source); // after the commit, all events in one transaction
  return results;
}

/** The body of ingestBatch, without a transaction: the caller owns it. */
export function ingestIn(db: DB, manifests: any[], source: Source, opts: ApplyOpts): WriteResult[] {
  const applied = manifests.map((m, i) => applyIn(db, m, source, manifests.length > 1 ? i : null, opts));
  const index = new Map<string, GraphIndex>();
  return applied.map(({ result, after }) => {
    if (!index.has(result.env)) { const g = buildIndex(loadModel(db, result.env)); index.set(result.env, g); opts.graphs?.set(result.env, g); }
    return { ...result, contract: contractReport({ service: result.service, ...after }, index.get(result.env)!) };
  });
}

/** In a real batch, say which manifest failed: message prefix plus details {batchIndex, service, ...}. */
function applyIn(db: DB, manifest: any, source: Source, index: number | null, opts: ApplyOpts) {
  try {
    return apply(db, manifest, source, opts);
  } catch (err) {
    if (index === null || !(err instanceof HttpError)) throw err;
    const service = typeof manifest?.service?.name === 'string' ? manifest.service.name : null;
    const d = err.details;
    const details = Array.isArray(d) ? { errors: d } : (d as object | undefined);
    throw new HttpError(err.status, err.code, `manifests[${index}] (${service ?? 'unnamed service'}): ${err.message}`, { batchIndex: index, service, ...details });
  }
}

function apply(db: DB, manifest: any, source: Source, opts: ApplyOpts): { result: WriteResult; after: Entities } {
  const errs = validateManifest(manifest);
  if (errs.length) throw invalid('manifest does not match schema', errs.slice(0, 50));
  if (manifest.service.owners !== undefined) manifest = { ...manifest, service: { ...manifest.service, owners: resolveOwners(db, manifest.service.owners, 'service.owners') } }; // names and external ids -> user ids (0.33.0)
  if (typeof manifest.service.about === 'string' && manifest.service.about.includes('@{')) manifest = { ...manifest, service: { ...manifest.service, about: resolveAbout(db, manifest.service.about) } }; // @{Name} -> @[id]
  const env = manifest.env ?? 'default';
  const name = manifest.service.name;
  guardEnv(db, env, opts.writer);
  if (opts.writer !== 'draft') ensureEnv(db, env);

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
    if (!opts.replaceHeader?.has(name)) {
      header = { ...rowToService(cur), ...manifest.service };
      delete header.version; delete header.harvestedAt; delete header.commit;
    }
    after = {};
    for (const l of LISTS) {
      const del = new Set(manifest.delete?.[l] ?? []);
      const map = new Map(((before as any)[l] ?? []).filter((e: any) => !del.has(keyOf(l, e))).map((e: any) => [keyOf(l, e), e]));
      for (const u of manifest.upsert?.[l] ?? []) map.set(keyOf(l, u), u);
      after[l] = [...map.values()];
    }
  }
  if (Array.isArray(header.owners) && !header.owners.length) { header = { ...header }; delete header.owners; }   // [] clears
  assertIntegrity(name, after, opts.tolerateExisting ? before : undefined);
  const changes = diff(before, after);
  upsertSnapshot(db, env, header, manifest.version, manifest.harvestedAt, manifest.commit);
  assignColorsIn(db, env, [{ name, kind: header.kind }]);
  replaceEntities(db, env, name, after);
  const changelogId = writeChangelog(db, env, name, cur?.version ?? null, manifest.version, manifest.kind, source, changes, opts.draftId);
  return { result: { env, service: name, fromVersion: cur?.version ?? null, toVersion: manifest.version, changes, changelogId }, after };
}
