// Write tools: manifest ingest and entity edits.

import { HttpError } from '../../errors.ts';
import { isList, LISTS } from '../../schema.ts';
import * as store from '../../store/snapshots.ts';
import { type Tool, env, obj, envOf, listArg } from './common.ts';

export const ingestManifestTool: Tool = {
  name: 'ingest_manifest', description: 'Submit a harvester manifest (kind full or delta). See schema/manifest.schema.json. The result has a `contract` report (what the manifest leaves out or cannot link, with a fix per finding). dryRun: true validates and reports without writing.',
  inputSchema: obj({ manifest: { type: 'object' }, manifests: { type: 'array', items: { type: 'object' }, description: 'Several manifests, applied together: all or nothing' }, dryRun: { type: 'boolean' } }),
  run: (c, a) => {
    if (!a.manifest && !a.manifests) throw new HttpError(400, 'BAD_REQUEST', 'send manifest or manifests');
    const rs = store.ingestBatch(c.db, a.manifests ?? [a.manifest], 'mcp', { dryRun: !!a.dryRun });
    if (!a.dryRun) new Set(rs.map((r) => r.env)).forEach((e) => c.changed(e));
    const out = a.manifests ? { results: rs } : rs[0];
    return a.dryRun ? { dryRun: true, ...out } : out;
  },
};

export const upsertEntityTool: Tool = {
  name: 'upsert_entity', description: `Create or replace one entity of a service. list: ${LISTS.join(', ')}.`,
  inputSchema: obj({ env, service: { type: 'string' }, list: { enum: [...LISTS] }, entity: { type: 'object' } }, ['service', 'list', 'entity']),
  run: (c, a) => { const r = store.upsertEntity(c.db, envOf(a), a.service, listArg(a.list), a.entity, 'mcp'); c.changed(r.env); return r; },
};

export const deleteEntityTool: Tool = {
  name: 'delete_entity', description: 'Delete one entity of a service by id (bindKey for channels).',
  inputSchema: obj({ env, service: { type: 'string' }, list: { enum: [...LISTS] }, key: { type: 'string' } }, ['service', 'list', 'key']),
  run: (c, a) => { const r = store.deleteEntity(c.db, envOf(a), a.service, listArg(a.list), a.key, 'mcp'); c.changed(r.env); return r; },
};
