// Manual edits: per-entity and per-service CRUD. Each is one transaction that bumps the version and logs.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { keyOf, validateEntity, validateServiceHeader, type ListName } from '../schema.ts';
import { conflict, invalid, notFound } from '../errors.ts';
import { getService, getSnapshotRow, loadEntities, type Entities, type Source, type WriteResult } from './snapshots-read.ts';
import { guardEnv } from './envs.ts';
import { assertIntegrity, diff, now, replaceEntities, upsertSnapshot, writeChangelog } from './snapshots-write.ts';


/** Apply a manual edit to one service. Bumps the version by one. */
function edit(db: DB, env: string, service: string, source: Source, mutate: (e: Required<Entities>) => void): WriteResult {
  return tx(db, () => {
    guardEnv(db, env, 'manual');
    const cur = getSnapshotRow(db, env, service);
    if (!cur) throw notFound(`service '${service}' in env '${env}'`);
    const before = loadEntities(db, env, service);
    const after = structuredClone(before);
    mutate(after);
    assertIntegrity(service, after, before); // problems the service already had do not block an edit that does not cause them
    const changes = diff(before, after);
    const to = cur.version + 1;
    db.prepare('UPDATE snapshots SET version = ?, updated_at = ? WHERE env = ? AND service = ?').run(to, now(), env, service);
    replaceEntities(db, env, service, after);
    const changelogId = writeChangelog(db, env, service, cur.version, to, 'crud', source, changes);
    return { env, service, fromVersion: cur.version, toVersion: to, changes, changelogId };
  });
}

export function upsertEntity(db: DB, env: string, service: string, list: ListName, data: any, source: Source = 'api') {
  const errs = validateEntity(list, data);
  if (errs.length) throw invalid(`${list} entity does not match schema`, errs);
  return edit(db, env, service, source, (e) => {
    const k = keyOf(list, data);
    const i = e[list].findIndex((x) => keyOf(list, x) === k);
    if (i >= 0) e[list][i] = data; else e[list].push(data);
  });
}

export function deleteEntity(db: DB, env: string, service: string, list: ListName, key: string, source: Source = 'api') {
  return edit(db, env, service, source, (e) => {
    const i = e[list].findIndex((x) => keyOf(list, x) === key);
    if (i < 0) throw notFound(`${list} '${key}' in service '${service}'`);
    e[list].splice(i, 1);
  });
}


export function createService(db: DB, env: string, header: any, source: Source = 'api') {
  const errs = validateServiceHeader(header);
  if (errs.length) throw invalid('service does not match schema', errs);
  return tx(db, () => {
    guardEnv(db, env, 'manual');
    if (getSnapshotRow(db, env, header.name)) throw conflict('EXISTS', `service '${header.name}' already exists in env '${env}'`);
    upsertSnapshot(db, env, header, 1, now());
    writeChangelog(db, env, header.name, null, 1, 'crud', source, { created: true });
    return getService(db, env, header.name);
  });
}

export function updateService(db: DB, env: string, name: string, patch: any, source: Source = 'api') {
  return tx(db, () => {
    guardEnv(db, env, 'manual');
    const cur = getService(db, env, name);
    const { version, harvestedAt, commit, ...rest } = cur;
    const header = { ...rest, ...patch, name };
    const errs = validateServiceHeader(header);
    if (errs.length) throw invalid('service does not match schema', errs);
    upsertSnapshot(db, env, header, version + 1, harvestedAt, commit);
    writeChangelog(db, env, name, version, version + 1, 'crud', source, { serviceUpdated: Object.keys(patch) });
    return getService(db, env, name);
  });
}

export function deleteService(db: DB, env: string, name: string, source: Source = 'api') {
  return tx(db, () => {
    guardEnv(db, env, 'manual');
    const cur = getSnapshotRow(db, env, name);
    if (!cur) throw notFound(`service '${name}' in env '${env}'`);
    db.prepare('DELETE FROM snapshots WHERE env = ? AND service = ?').run(env, name);
    writeChangelog(db, env, name, cur.version, null, 'delete-service', source, {});
    return { deleted: name };
  });
}
