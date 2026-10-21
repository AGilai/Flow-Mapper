// Redis instances (#29). An instance is the cluster or server in a bind key's group: `redis:cache-main`
// groups `redis:cache-main/order:{id}`, and an infra harvester may define it with a resource whose key is
// just `redis:cache-main` (version, nodes, topology). Who connects comes from the services' resources: access
// (the resource's `details.access`, else its steps, else the key entries) and the #27 `client`. Key templates are
// the entries pushed per instance (core/keys.ts), or the interim inline `details.keys`. Pure.

import type { GraphIndex } from './graph-index.ts';
import { sid } from './graph-index.ts';
import { clientRows, type ClientRow } from './clients.ts';
import { codeLink, type SourceLink } from './endpoint-info.ts';
import { entryPointsReaching } from './reach.ts';
import { accessOf, groupOf, instanceDef, storeKey, usesOf, type Access } from './stores.ts';
import { unresolvedTarget } from './resolve.ts';
import { assumedUnder } from './assumed.ts';
import { asNum, assumedAt, det, nameOf, unknownOf } from './instance-notes.ts';
import { filterRows, groupRows, keyRows, keySummary, normaliseKeys, problemService, type KeyEntry, type KeyFilter, type KeyFlow, type KeyGroup, type KeySummary } from './keys.ts';
import type { Assumed, Fn, Resource } from './types.ts';

export type KeySource = 'pushed' | 'inline' | 'none';
export interface KeyMeta { version: number; pushedAt: string; producer?: string | null }

const isRedis = (r: Resource) => r.kind === 'redis' && !!r.bindKey && !unresolvedTarget(r);
const ACCESSES = ['read', 'write', 'read_write'];

interface Group { key: string; defs: Resource[]; members: Resource[] }
function groups(g: GraphIndex): Map<string, Group> {
  const by = new Map<string, Group>();
  for (const r of g.model.resources) {
    if (!isRedis(r)) continue;
    const def = instanceDef(g, r);
    const key = def ? r.bindKey! : groupOf(storeKey(r));
    const x = by.get(key) ?? by.set(key, { key, defs: [], members: [] }).get(key)!;
    (def ? x.defs : x.members).push(r);
  }
  return by;
}

/** The instance key for an id from a URL or a tool: the key (`redis:cache-main`), the defining resource's id, or the bare name (`cache-main`). */
export function resolveInstance(g: GraphIndex, id: string): string | null {
  const all = groups(g);
  if (all.has(id)) return id;
  const byDef = [...all.values()].filter((x) => x.defs.some((d) => d.id === id));
  if (byDef.length === 1) return byDef[0].key;
  const byName = [...all.keys()].filter((k) => k === `redis:${id}`);
  return byName.length === 1 ? byName[0] : null;
}

export const instanceKeys = (g: GraphIndex) => [...groups(g).keys()].sort();

/** Key entries from the interim inline `details.keys` (top N) of the instance's resources. */
export function inlineEntries(g: GraphIndex, key: string): KeyEntry[] {
  const x = groups(g).get(key);
  if (!x) return [];
  const out: KeyEntry[] = [];
  for (const r of [...x.defs, ...x.members]) {
    const raw = (r.details as any)?.keys;
    if (Array.isArray(raw)) out.push(...normaliseKeys(raw, r.service).entries);
  }
  return out;
}

/** The entries to read: pushed ones win; otherwise the inline ones. */
export function keysOf(g: GraphIndex, key: string, pushed: KeyEntry[] = []): { source: KeySource; entries: KeyEntry[] } {
  if (pushed.length) return { source: 'pushed', entries: pushed };
  const inline = inlineEntries(g, key);
  return inline.length ? { source: 'inline', entries: inline } : { source: 'none', entries: [] };
}

export interface Lane {
  service: string; kind?: string; team?: string; description?: string;
  access: Access; accessFrom: 'declared' | 'steps' | 'keys' | 'unknown';
  clients: ClientRow[]; databases: number[]; resources: string[];
  /** Why the databases are unknown (`unresolved` what=detail, detail `client.databases`, on one of its resources). */
  databasesUnknown?: string;
  databasesAssumed?: Assumed; // `assumed` detail `client.databases` on one of its resources (#47)
  /** Key templates this service uses (writes or reads) in the instance's key list. */
  keyCount: number;
}
/** `service`: whose card the callout opens (see problemService). */
export interface Callout { kind: 'no-writer' | 'ttl-disagree'; text: string; service: string | null; row: { keyTemplate: string; dbIndex: number } }
export interface InstanceSummary { key: string; name: string; kind: 'redis'; topology: 'cluster' | 'instance'; team?: string; services: string[]; databases: number; templates: number; problems: number }
export interface InstanceView extends InstanceSummary {
  definition: { service: string; id: string; source: SourceLink | null; verified: string | null; runId?: string; producer?: string } | null;
  engineVersion?: string; nodes?: number;
  lanes: Lane[];
  stores: { key: string; name: string; services: string[]; readers: string[]; writers: string[] }[];
  keys: { source: KeySource; version: number | null; pushedAt: string | null; producer: string | null; summary: KeySummary | null; lazy: { kind: string; ref?: string } | null };
  callouts: Callout[];
  /** Instance fields the infra harvester could not read (`unresolved` what=detail, detail `details.<field>`), each with its reason. */
  unknown: { field: string; reason: string }[];
  assumed: (Assumed & { field: string })[]; // instance fields filled by a rule (`assumed`, detail `details.<field>`, #47)
}

const topologyOf = (defs: Resource[]): 'cluster' | 'instance' => {
  const t = String(det(defs, 'topology') ?? det(defs, 'mode') ?? '').toLowerCase();
  return t === 'cluster' || (t === '' && det(defs, 'cluster') === true) ? 'cluster' : 'instance';
};
const teamOf = (g: GraphIndex, x: Group) => {
  const owner = x.defs.map((r) => g.services.get(r.service)?.team).find(Boolean);
  if (owner) return owner;
  const t = x.members.map((r) => g.services.get(r.service)?.team).filter(Boolean) as string[];
  const n = new Map<string, number>();
  for (const s of t) n.set(s, (n.get(s) ?? 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
};
const serviceNames = (x: Group) => [...new Set(x.members.map((r) => r.service))].sort();

/** Read and write together are read_write (stores.ts mergeAccess keeps one pill per use and calls that 'write'). */
const combine = (xs: Access[]): Access => {
  const r = xs.some((a) => a === 'read' || a === 'read_write'), w = xs.some((a) => a === 'write' || a === 'read_write');
  return r && w ? 'read_write' : w ? 'write' : r ? 'read' : 'unknown';
};

const accessOfService = (g: GraphIndex, rs: Resource[], entries: KeyEntry[], service: string): { access: Access; from: Lane['accessFrom'] } => {
  const declared = rs.map((r) => (r.details as any)?.access).filter((a) => ACCESSES.includes(a)) as Access[];
  if (declared.length) return { access: combine(declared), from: 'declared' };
  const steps = combine(rs.flatMap((r) => usesOf(g, r).flatMap((u) => u.steps)).map(accessOf));
  if (steps !== 'unknown') return { access: steps, from: 'steps' };
  const ks = entries.filter((e) => e.service === service);
  if (ks.length) return { access: combine(ks.map((e) => e.access as Access)), from: 'keys' };
  return { access: 'unknown', from: 'unknown' };
};

function lanes(g: GraphIndex, x: Group, entries: KeyEntry[]): Lane[] {
  const clients = clientRows(g, { store: x.key }).filter((c) => c.store === x.key || c.store?.startsWith(x.key + '/'));
  return serviceNames(x).map((service) => {
    const rs = x.members.filter((r) => r.service === service);
    const svc = g.services.get(service);
    const cs = clients.filter((c) => c.service === service);
    const dbs = new Set<number>([...rs.flatMap((r) => r.client?.databases ?? []), ...entries.filter((e) => e.service === service).map((e) => e.dbIndex)]);
    const a = accessOfService(g, rs, entries, service);
    return { service, kind: svc?.kind, team: svc?.team, description: svc?.description, access: a.access, accessFrom: a.from, clients: cs, databases: [...dbs].sort((p, q) => p - q), resources: rs.map((r) => r.id), databasesUnknown: unknownOf(rs, 'client.databases')[0]?.reason, databasesAssumed: assumedAt(rs, 'client.databases'),
      keyCount: new Set(entries.filter((e) => e.service === service).map((e) => `${e.dbIndex}\u0000${e.keyTemplate}`)).size };
  });
}

/** Everything the inventory needs about one instance. `stored` is the summary kept when the keys were pushed. */
function summaryOf(g: GraphIndex, x: Group, stored?: KeySummary | null): InstanceSummary {
  const sum = stored ?? (() => { const e = keysOf(g, x.key).entries; return e.length ? keySummary(e) : null; })();
  const dbs = new Set<number>([...x.members.flatMap((r) => r.client?.databases ?? []), ...(sum?.dbs.map((d) => d.db) ?? [])]);
  return {
    key: x.key, name: nameOf(x.key), kind: 'redis', topology: topologyOf(x.defs), team: teamOf(g, x), services: serviceNames(x),
    databases: dbs.size || (asNum(det(x.defs, 'databases')) ?? 0), templates: sum?.templates ?? 0, problems: sum?.problemCount ?? 0,
  };
}

/** Every instance of the env. `summaries`: the stored key summary per instance key (from the server's table). */
export function instances(g: GraphIndex, summaries: Map<string, KeySummary> = new Map()): InstanceSummary[] {
  return [...groups(g).values()].map((x) => summaryOf(g, x, summaries.get(x.key)))
    .sort((a, b) => a.key.localeCompare(b.key));
}

export function instanceView(g: GraphIndex, id: string, pushed: KeyEntry[] = [], meta: KeyMeta | null = null): InstanceView | null {
  const key = resolveInstance(g, id);
  const x = key && groups(g).get(key);
  if (!x) return null;
  const k = keysOf(g, x.key, pushed);
  const summary = k.entries.length ? keySummary(k.entries) : null;
  const base = summaryOf(g, x, summary);
  const def = x.defs[0];
  const defSvc = def && g.services.get(def.service);
  const lazy = (det([...x.defs, ...x.members], 'lazy') as any) ?? null;
  const rows = summary ? keyRows(k.entries) : [];
  const callouts: Callout[] = rows.filter((r) => r.problem).slice(0, 6).map((r) => ({
    kind: r.problem!.kind, service: problemService(r), row: { keyTemplate: r.keyTemplate, dbIndex: r.dbIndex },
    text: r.problem!.kind === 'ttl-disagree'
      ? `${r.keyTemplate} is written by ${r.writers.length} services (${r.writers.map((w) => w.service).join(', ')}) that disagree on its TTL.`
      : `${r.keyTemplate} is read by ${r.readers.map((w) => w.service).join(', ')} but written by no harvested service.`,
  }));
  return {
    ...base,
    definition: def ? { service: def.service, id: def.id, source: defSvc ? codeLink(defSvc, def.source) : null, verified: def.provenance?.verified ?? null, runId: def.provenance?.runId, producer: def.provenance?.producer } : null,
    engineVersion: det(x.defs, 'engineVersion') != null ? String(det(x.defs, 'engineVersion')) : undefined, nodes: asNum(det(x.defs, 'nodes')),
    lanes: lanes(g, x, k.entries),
    stores: [...new Map(x.members.map((r) => [storeKey(r), r])).keys()].sort().map((sk) => {
      const rs = x.members.filter((r) => storeKey(r) === sk);
      const uses = rs.flatMap((r) => usesOf(g, r).flatMap((u) => u.steps.map((s) => ({ service: r.service, a: accessOf(s) }))));
      const names = (f: (a: Access) => boolean) => [...new Set(uses.filter((u) => f(u.a)).map((u) => u.service))];
      return { key: sk, name: sk.includes('/') ? sk.slice(sk.indexOf('/') + 1) : sk, services: [...new Set(rs.map((r) => r.service))], readers: names((a) => a === 'read' || a === 'read_write'), writers: names((a) => a === 'write' || a === 'read_write') };
    }),
    keys: { source: k.source, version: meta?.version ?? null, pushedAt: meta?.pushedAt ?? null, producer: meta?.producer ?? null, summary, lazy: lazy && typeof lazy === 'object' ? lazy : null },
    callouts,
    unknown: unknownOf(x.defs, 'details.'),
    assumed: x.defs.flatMap((r) => assumedUnder(r.assumed, 'details.')),
  };
}

/** Steps (function + seq) of the instance's resources that name a key template in `details.keyTemplate`. */
function stepsByTemplate(g: GraphIndex, x: Group) {
  const ids = new Set(x.members.map((r) => sid(r.service, r.id)));
  const by = new Map<string, { fn: Fn; step: Fn['steps'][number] }[]>();
  for (const fn of g.model.functions) for (const step of fn.steps) {
    const t = step.type === 'resource' && step.target && ids.has(sid(fn.service, step.target)) ? (step.details as any)?.keyTemplate : undefined;
    if (typeof t === 'string') (by.get(t) ?? by.set(t, []).get(t)!).push({ fn, step });
  }
  return by;
}

/** Function names from an ingress's handler (or middleware, event handler) down call steps to `target`, within one service. */
function chainTo(g: GraphIndex, service: string, ingress: string, target: string): string[] {
  const i = g.ingress.get(sid(service, ingress));
  if (!i) return [];
  const roots = [...new Set([i.handler, ...(i.middleware ?? []), ...(i.events ?? []).map((e) => e.handler)])];
  const prev = new Map<string, string | null>(roots.map((r) => [r, null]));
  const queue = [...roots];
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur === target) {
      const path: string[] = [];
      for (let c: string | null | undefined = cur; c; c = prev.get(c)) path.unshift(g.fns.get(sid(service, c))?.name ?? c);
      return path;
    }
    for (const s of g.fns.get(sid(service, cur))?.steps ?? []) {
      if (s.type === 'call' && s.target && !prev.has(s.target) && g.fns.has(sid(service, s.target))) { prev.set(s.target, cur); queue.push(s.target); }
    }
  }
  return [];
}

const opLabel = (operation: string | undefined, ttl: unknown) => `${(operation ?? 'use').trim().split(/\s+/)[0].toUpperCase()}${typeof ttl === 'number' ? ` + EX ${ttl}` : ''}`;

/** Flows that touch each template: entry points reaching a step that names it, with the function chain to the call. */
export function keyFlows(g: GraphIndex, key: string, templates: { keyTemplate: string; dbIndex?: number }[]): Map<string, KeyFlow[]> {
  const x = groups(g).get(key);
  const out = new Map<string, KeyFlow[]>();
  if (!x) return out;
  const steps = stepsByTemplate(g, x);
  for (const { keyTemplate, dbIndex } of templates) {
    const flows: KeyFlow[] = [];
    for (const { fn, step } of steps.get(keyTemplate) ?? []) {
      const sdb = (step.details as any)?.dbIndex;
      if (dbIndex != null && Number.isInteger(sdb) && sdb !== dbIndex) continue;
      const ttl = (step.details as any)?.ttlSeconds;
      for (const hit of entryPointsReaching(g, [{ service: fn.service, fn: fn.id }])) {
        const chain = hit.service === fn.service ? chainTo(g, hit.service, hit.ingress, fn.id) : [];
        flows.push({
          access: accessOf(step), service: hit.service, ingress: hit.ingress, bindKey: hit.bindKey, transport: hit.transport, entryPoint: hit.entryPoint,
          chain: chain.length ? chain : [fn.name], operation: opLabel(step.operation, ttl), step: { service: fn.service, fn: fn.id, seq: step.seq }, ...(typeof ttl === 'number' ? { ttlSeconds: ttl } : {}),
        });
      }
    }
    out.set(`${dbIndex ?? ''}\u0000${keyTemplate}`, flows);
  }
  return out;
}

export interface KeysView {
  instance: string; source: KeySource; version: number | null; pushedAt: string | null; producer: string | null;
  /** Counts over every db (the filter below does not change them). */
  summary: KeySummary | null; filter: KeyFilter; shown: number; groups: KeyGroup[];
}

/** The key list of one instance, grouped by owner, filtered by db / text / problems, each row with the flows that touch it. */
export function keysView(g: GraphIndex, id: string, pushed: KeyEntry[], meta: KeyMeta | null, filter: KeyFilter = {}): KeysView | null {
  const key = resolveInstance(g, id);
  if (!key) return null;
  const k = keysOf(g, key, pushed);
  const all = keyRows(k.entries);
  const rows = filterRows(all, filter);
  const flows = keyFlows(g, key, rows.map((r) => ({ keyTemplate: r.keyTemplate, dbIndex: r.dbIndex })));
  for (const r of rows) r.flows = flows.get(`${r.dbIndex}\u0000${r.keyTemplate}`) ?? [];
  return {
    instance: key, source: k.source, version: k.source === 'pushed' ? meta?.version ?? null : null, pushedAt: k.source === 'pushed' ? meta?.pushedAt ?? null : null,
    producer: meta?.producer ?? null, summary: k.entries.length ? keySummary(k.entries, all) : null, filter, shown: rows.length, groups: groupRows(rows),
  };
}
