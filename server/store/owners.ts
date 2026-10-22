// Owners as writers send them (0.33.0): names, user ids or { externalSource, externalId } become the user ids the headers and groups store. The same matching as
// every other place that meets a person (core/users-match.ts through ensureUser): external id first, then an exact name or alias, else a new user.

import type { DB } from '../db/connection.ts';
import { invalid } from '../errors.ts';
import { MAX_OWNERS, ownerProbe, cleanOwners } from '../../core/owners.ts';
import { resolveNamed } from '../../core/mentions.ts';
import { matchUser } from '../../core/users-match.ts';
import { ensureUser, findUser, listUsers } from './users.ts';

/** resolveOwners(db, entries) -> user ids, without duplicates. `undefined` stays undefined (keep), an empty list is [] (clear). A bad entry is a 422 naming where. */
export function resolveOwners(db: DB, entries: unknown, where = 'owners'): string[] | undefined {
  if (entries === undefined) return undefined;
  if (entries === null) return [];
  if (!Array.isArray(entries)) throw invalid(`${where} must be a list`);
  if (entries.length > MAX_OWNERS) throw invalid(`${where} has more than ${MAX_OWNERS} entries`);
  const ids: string[] = [];
  entries.forEach((e, i) => {
    const p = ownerProbe(e);
    if (typeof p === 'string') throw invalid(`${where}[${i}]: ${p}`);
    if (p.id) { if (!findUser(db, p.id)) throw invalid(`${where}[${i}]: no user '${p.id}'`); ids.push(p.id); return; }
    ids.push(ensureUser(db, { name: p.name ?? p.externalId!, source: p.source, externalId: p.externalId })!.id);
  });
  return cleanOwners(ids) ?? [];
}

/** `@{Display Name}` in an about becomes the token `@[userId]` when a user of that name (or alias) exists; an unknown name stays plain `@Name` text (nobody is created by a mention).
 *  The same rule as add_comment (0.32.0): a harvester or an agent writes names, the stored text holds ids. Text without `@{` is returned as it is. */
export function resolveAbout<T>(db: DB, text: T): T {
  if (typeof text !== 'string' || !text.includes('@{')) return text;
  const users = listUsers(db);
  return resolveNamed(text, (name) => matchUser(users, { name })?.user.id ?? null) as unknown as T;
}

/** A plan with the owners a writer named turned into user ids: `manifests[].service.owners`, `extensions[].owners`, `environment.groups[].owners` and `groups[].owners`. The plan is copied, not changed. */
export function resolvePlanOwners(db: DB, plan: any): any {
  if (!plan || typeof plan !== 'object') return plan;
  const out = { ...plan };
  const map = (list: unknown, where: string, pick: (x: any) => any, put: (x: any, o: string[]) => any) =>
    Array.isArray(list) ? list.map((x, i) => (x && typeof x === 'object' && pick(x)?.owners !== undefined ? put(x, resolveOwners(db, pick(x).owners, `${where}[${i}].owners`) ?? []) : x)) : list;
  if (plan.manifests !== undefined) out.manifests = map(plan.manifests, 'manifests', (m) => m.service, (m, o) => ({ ...m, service: { ...m.service, owners: o } }));
  if (plan.extensions !== undefined) out.extensions = map(plan.extensions, 'extensions', (x) => x, (x, o) => ({ ...x, owners: o }));
  if (plan.groups !== undefined) out.groups = map(plan.groups, 'groups', (x) => x, (x, o) => ({ ...x, owners: o }));
  if (plan.environment && typeof plan.environment === 'object' && plan.environment.groups !== undefined) out.environment = { ...plan.environment, groups: map(plan.environment.groups, 'environment.groups', (x) => x, (x, o) => ({ ...x, owners: o })) };
  // `@{Name}` in an about -> `@[id]` (resolveAbout)
  const abouts = (list: unknown, pick: (x: any) => any, put: (x: any, v: any) => any) => (Array.isArray(list) ? list.map((x) => (x && typeof x === 'object' && typeof pick(x)?.about === 'string' && pick(x).about.includes('@{') ? put(x, resolveAbout(db, pick(x).about)) : x)) : list);
  if (out.manifests !== undefined) out.manifests = abouts(out.manifests, (m) => m.service, (m, v) => ({ ...m, service: { ...m.service, about: v } }));
  if (out.extensions !== undefined) out.extensions = abouts(out.extensions, (x) => x, (x, v) => ({ ...x, about: v }));
  if (out.groups !== undefined) out.groups = abouts(out.groups, (x) => x, (x, v) => ({ ...x, about: v }));
  if (out.environment?.groups !== undefined) out.environment = { ...out.environment, groups: abouts(out.environment.groups, (x) => x, (x, v) => ({ ...x, about: v })) };
  return out;
}
