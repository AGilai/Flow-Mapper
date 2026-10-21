// Create a design environment by copying another one (any kind), in one transaction:
//   blank       only the environment row
//   components  the picked services with their ingress, egress, channels, bindings, resources, DTOs, schemas and Redis keys;
//               no functions or steps (so no flows)
//   full        everything of the source: all services including functions, flows, descriptions (not bugs)
// A design owns its rows (no sharing with the source). The rows copied from a sealed environment become its baseline;
// a copy of a design keeps that design's original baseline.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { badRequest, conflict, invalid, notFound } from '../errors.ts';
import { getEnv, getEnvRow, type EnvGroup, type EnvMeta } from './envs.ts';
import { copyAllBaseline, copyDescriptions, copyDtos, copyKeys, copyService, copyShared, type CopyCtx } from './env-copy-rows.ts';
import { copySharedChannels } from './env-copy-channels.ts';
import { writeChangelog } from './snapshots-write.ts';

export type CopyMode = 'blank' | 'components' | 'full';
export interface CopyInput {
  name: string; source: string; mode: CopyMode; groups?: EnvGroup[]; levels?: string[];
  services?: { name: string; groupPath?: string }[]; createdBy?: string;
}

const NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PATH = /^[a-z0-9][a-z0-9-]*(\/[a-z0-9][a-z0-9-]*)*$/;
const RESERVED = new Set(['meta', 'new']);

function validate(db: DB, i: CopyInput) {
  if (!i || typeof i !== 'object') throw badRequest('body must be {name, source, mode, groups, levels, services}');
  if (typeof i.name !== 'string' || !NAME.test(i.name) || RESERVED.has(i.name)) throw invalid(`name '${i.name ?? ''}' must be lowercase letters, digits and '-' (it is used in links), at most 63 characters`);
  if (!['blank', 'components', 'full'].includes(i.mode)) throw invalid("mode must be 'blank', 'components' or 'full'");
  const src = typeof i.source === 'string' ? getEnvRow(db, i.source) : undefined;
  if (!src) throw notFound(`source environment '${i.source}'`);
  if (getEnvRow(db, i.name)) throw conflict('EXISTS', `environment '${i.name}' already exists`);
  const groups = i.groups ?? [];
  if (!Array.isArray(groups)) throw invalid('groups must be a list of {key, label}');
  const keys = new Set<string>();
  for (const g of groups) {
    if (!g || typeof g.key !== 'string' || !PATH.test(g.key) || typeof g.label !== 'string' || !g.label.trim()) throw invalid(`group ${JSON.stringify(g)} needs a key (lowercase, '-' or a path like platform/identity) and a label`);
    if (keys.has(g.key)) throw invalid(`group '${g.key}' is listed twice`);
    keys.add(g.key);
  }
  const levels = i.levels ?? ['Subsystem', 'Component'];
  if (!Array.isArray(levels) || !levels.length || levels.length > 4 || levels.some((l) => typeof l !== 'string' || !l.trim())) throw invalid('levels must be a list of 1 to 4 names, outermost first');
  const services = i.services ?? [];
  if (!Array.isArray(services)) throw invalid('services must be a list of {name, groupPath}');
  for (const s of services) {
    if (typeof s?.name !== 'string') throw invalid('each service needs a name');
    if (s.groupPath !== undefined && s.groupPath !== '' && !keys.has(s.groupPath) && i.mode !== 'full') throw invalid(`service '${s.name}': groupPath '${s.groupPath}' is not one of the environment's groups`);
  }
  return { src, groups, levels, services };
}

export function copyEnv(db: DB, input: CopyInput): EnvMeta {
  const v = validate(db, input);
  const { name, source, mode } = input;
  return tx(db, () => {
    const at = new Date().toISOString();
    // A full copy of a design carries its subsystems (unless the request names others).
    const fullOfDesign = mode === 'full' && v.src.kind === 'design';
    const groups = v.groups.length || !fullOfDesign ? v.groups : JSON.parse(v.src.groups);
    const levels = input.levels || !fullOfDesign ? v.levels : JSON.parse(v.src.levels);
    db.prepare('INSERT INTO envs (name, kind, source, copied_at, levels, groups, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(name, 'design', source, at, JSON.stringify(levels), JSON.stringify(groups), at, String(input.createdBy ?? 'anonymous').slice(0, 80));
    if (mode === 'blank') return getEnv(db, name);

    const all = (db.prepare('SELECT service FROM snapshots WHERE env = ? ORDER BY service').all(source) as { service: string }[]).map((r) => r.service);
    const picks = mode === 'full' ? v.services.filter((s) => all.includes(s.name)) : v.services;
    const names = mode === 'full' ? all : picks.map((s) => s.name);
    if (mode === 'components') {
      if (!names.length) throw invalid('pick at least one component to copy');
      const unknown = names.filter((n) => !all.includes(n));
      if (unknown.length) throw notFound(`component(s) ${unknown.map((n) => `'${n}'`).join(', ')} in environment '${source}'`);
      if (new Set(names).size !== names.length) throw invalid('a component is picked twice');
    }
    const path = new Map(picks.map((s) => [s.name, s.groupPath]));
    const c: CopyCtx = { db, from: source, to: name, at, fromKind: v.src.kind, mode: mode as 'components' | 'full' };
    const types = new Set<string>(), stores = new Set<string>();
    for (const n of names) {
      const r = copyService(c, n, path.get(n))!;
      r.types.forEach((t) => types.add(t)); r.stores.forEach((s) => stores.add(s));
      copyDtos(c, n);
      writeChangelog(db, name, n, null, r.version, 'copy', 'api', { copiedFrom: source, mode, entities: r.entities });
    }
    if (mode === 'components') copySharedChannels(c, new Set(names));
    copyShared(c, types, stores);
    copyKeys(c, new Set(names));
    if (mode === 'full') { copyDescriptions(c); copyAllBaseline(c); }
    return getEnv(db, name);
  });
}
