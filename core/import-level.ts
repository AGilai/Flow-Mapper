// Import one level of another environment into a design: what comes along with an endpoint (`ing:`) or a component (`svc:`).
// Pure: the server passes the source's rows and graph and the design's rows (environment + draft overlay). Rules: docs/DESIGN.md
// "References and import". Nothing already in the design is imported again (the design's version is kept, even if it was edited);
// what the imported behaviour calls in other components stays a reference, listed so the next level is an explicit choice.

import type { GraphIndex } from './graph-index.ts';
import { linksFrom, sid } from './graph-index.ts';
import { anchorOfRow, parseAnchor } from './anchors.ts';
import { same } from './diff/normalise.ts';
import type { OpOrigin } from './draft-ops.ts';
import { infraBindingId } from './infra-owner.ts';
import { rowId, rowLabel, type ItemRow } from './item-rows.ts';
import { handlersOf } from './references.ts';
import { refKey } from './resolve.ts';
import type { Ref } from './types.ts';

export type Why = 'header' | 'ingress' | 'handler' | 'inside' | 'middleware' | 'egress' | 'resource' | 'schema' | 'event_dto' | 'dto' | 'channel' | 'binding' | 'owner' | 'reference';
export interface ImportInput {
  source: string; anchor: string; srcRows: ItemRow[]; srcGraph: GraphIndex; srcVersions: Map<string, number>;
  /** The design's rows: environment with the draft laid over it. */
  here: ItemRow[]; groups: string[]; groupPath?: string; infraOwner: string;
}
export interface ImportItem { row: ItemRow; why: Why; origin: OpOrigin }
export interface RefTarget { service: string; ingress: string; bindKey: string; label: string; state: 'designed' | 'reference' | 'new-reference' }
export interface ImportSet {
  level: 'endpoint' | 'component'; items: ImportItem[];
  alreadyHere: { anchor: string; label: string; differs: boolean }[]; references: RefTarget[];
  /** What the imported behaviour does, for the preview: its handler, the calls it makes (all of them, here already or not) and the stores it touches. */
  uses: { handler?: string; calls: { anchor: string; label: string }[]; stores: { key: string; access?: string }[] };
}
export class ImportError extends Error {
  code: 'NO_ITEM' | 'BAD_ANCHOR' | 'NOTHING_TO_IMPORT' | 'NO_GROUP';
  constructor(code: ImportError['code'], message: string) { super(message); this.code = code; }
}

const GLOB = /[*?]/;
const dtoIngress = (key: string) => { const a = key.lastIndexOf('|'), b = key.lastIndexOf('|', a - 1); return key.slice(0, b); };
const READ = /^(select|get|find|read|scan|query|fetch|list)\b/i, WRITE = /^(insert|update|put|set|delete|del|write|upsert|create|remove|incr)/i;

/** The label of a row in lists: the bind key of an endpoint, call or channel, else the id (`request of in.x` for a DTO). */
export const labelOf = (r: ItemRow): string => (['ingress', 'egress'].includes(r.list) && r.data?.bindKey ? r.data.bindKey : rowLabel(r));

export function importSet(i: ImportInput): ImportSet {
  const p = parseAnchor(i.anchor);
  if (!p || p.field !== undefined || (p.kind !== 'ing' && p.kind !== 'svc')) throw new ImportError('BAD_ANCHOR', `'${i.anchor}' cannot be imported: give ing:<service>/<id> (an endpoint with its behaviour) or svc:<service> (a component's endpoints as references)`);
  if (i.groupPath && !i.groups.includes(i.groupPath)) throw new ImportError('NO_GROUP', `groupPath '${i.groupPath}' is not one of this environment's subsystems`);
  const src = new Map(i.srcRows.map((r) => [rowId(r), r])), here = new Map(i.here.map((r) => [rowId(r), r]));
  const rowsOf = (service: string, list: string) => i.srcRows.filter((r) => r.service === service && r.list === list);
  const get = (service: string, list: string, key = '') => src.get(rowId({ service, list, key }));
  const items = new Map<string, ImportItem>(), already = new Map<string, ImportSet['alreadyHere'][number]>(), refs = new Map<string, RefTarget>();
  const hereChannels = new Set(i.here.filter((r) => r.list === 'channels').map((r) => r.key));
  const hereHeaders = new Set(i.here.filter((r) => r.list === 'header').map((r) => r.service));
  const comes = (service: string) => hereHeaders.has(service) || items.has(rowId({ service, list: 'header', key: '' }));

  const want = (row: ItemRow, why: Why) => {
    const id = rowId(row), have = here.get(id) ?? (row.list === 'channels' ? i.here.find((r) => r.list === 'channels' && r.key === row.key) : undefined);
    if (items.has(id)) return;
    if (have) { if (row.list !== 'header') already.set(id, { anchor: anchorOfRow(row), label: labelOf(row), differs: !same(row.list, have.data, row.data) }); return; }
    items.set(id, { row, why, origin: { env: i.source, version: (row.service && i.srcVersions.get(row.service)) || null } });
  };
  const header = (service: string, why: Why = 'header') => {
    const h = get(service, 'header');
    if (!h || comes(service)) return;
    const { version: _v, harvestedAt: _h, commit: _c, groupPath: own, ...rest } = h.data ?? {};
    const path = i.groupPath !== undefined ? i.groupPath : own && i.groups.includes(own) ? own : '';
    want({ service, list: 'header', key: '', data: { ...rest, ...(path ? { groupPath: path } : {}) } }, why);
  };
  const owner = () => { if (!comes(i.infraOwner)) want({ service: i.infraOwner, list: 'header', key: '', data: { kind: 'infra', description: `Channels and bindings imported from ${i.source}.` } }, 'owner'); return i.infraOwner; };
  const eventTypes = new Set<string>(), storeKeys = new Set<string>();
  const dtosOf = (service: string, ingress: string, why: Why = 'dto') => { for (const r of rowsOf(service, 'dto')) if (dtoIngress(r.key) === ingress) want(r, why); };
  const types = (xs: unknown) => { for (const t of Array.isArray(xs) ? xs : []) if (typeof t === 'string' && !GLOB.test(t)) eventTypes.add(t); };

  const egressRows: ItemRow[] = [], uses = { calls: new Map<string, string>(), stores: new Map<string, Set<string>>() };
  let handler: string | undefined;
  /** An endpoint, its DTOs and its function closure inside its component, with what those functions use. Returns the downstream links to look at. */
  const endpoint = (ing: ItemRow, first: boolean) => {
    const s = ing.service;
    header(s);
    want(ing, 'ingress');
    dtosOf(s, ing.key);
    for (const e of ing.data.events ?? []) types([e.type]);
    const seen = new Set<string>(), queue: [string, Why][] = [...handlersOf(ing.data).map((h): [string, Why] => [h, 'handler']), ...(ing.data.middleware ?? []).map((m: string): [string, Why] => [m, 'middleware'])];
    if (first) handler = handlersOf(ing.data)[0];
    while (queue.length) {
      const [id, why] = queue.shift()!;
      const f = get(s, 'functions', id);
      if (!f || seen.has(id)) continue;
      seen.add(id);
      want(f, why);
      for (const st of f.data.steps ?? []) {
        if (!st.target) continue;
        if (st.type === 'call') queue.push([st.target, 'inside']);
        else if (st.type === 'egress') {
          const e = get(s, 'egress', st.target);
          if (!e) continue;
          want(e, 'egress'); egressRows.push(e); types(e.data.events); if (st.event) types([st.event]);
          uses.calls.set(anchorOfRow(e), labelOf(e));
        } else if (st.type === 'resource') {
          const r = get(s, 'resources', st.target);
          if (!r) continue;
          want(r, 'resource'); if (r.data.bindKey) storeKeys.add(r.data.bindKey);
          const k = r.data.bindKey ?? r.key, acc = uses.stores.get(k) ?? new Set<string>();
          acc.add(st.access ?? (READ.test(st.operation ?? '') ? 'read' : WRITE.test(st.operation ?? '') ? 'write' : '')); uses.stores.set(k, acc);
        }
      }
    }
  };
  /** Where a channel or binding row goes: its source owner when that component is in the design (or comes along), else the infra owner. */
  const reown = (r: ItemRow, s: string): ItemRow => (r.service === s || comes(r.service) ? r : r.list === 'bindings'
    ? { service: owner(), list: 'bindings', key: infraBindingId(r.service, r.key), data: { ...r.data, id: infraBindingId(r.service, r.key) } } : { ...r, service: owner() });
  const downstream = (s: string, e: ItemRow) => {
    const seen = new Set<string>(), out: { ingress: ItemRow; chs: string[]; bs: { service: string; id: string }[] }[] = [];
    const walk = (r: Ref, chs: string[], bs: { service: string; id: string }[]) => {
      for (const l of linksFrom(i.srcGraph, r)) {
        const k = refKey(l.to);
        if (seen.has(k)) continue;
        seen.add(k);
        const b = l.binding ? [...bs, l.binding] : bs;
        if (l.to.type === 'ingress') { const t = get(l.to.service, 'ingress', l.to.id); if (t) out.push({ ingress: t, chs, bs: b }); }
        else if (l.to.type === 'channel') walk(l.to, [...chs, l.to.key], b);
      }
    };
    walk({ type: 'egress', service: s, id: e.key }, [], []);
    return out;
  };
  const done = new Set<string>();
  const run = (ing: ItemRow, first: boolean) => {
    if (done.has(rowId(ing))) return;
    done.add(rowId(ing));
    const from = egressRows.length;
    endpoint(ing, first);
    const mine = egressRows.slice(from);
    for (const e of mine) for (const d of downstream(ing.service, e)) {
      for (const k of d.chs) { const c = i.srcRows.find((r) => r.list === 'channels' && r.key === k); if (c) want(reown(c, ing.service), 'channel'); }
      for (const b of d.bs) { const r = get(b.service, 'bindings', b.id); if (r) want(reown(r, ing.service), 'binding'); }
      const t = d.ingress;
      if (t.service === ing.service) { run(t, false); continue; }
      const mineHere = here.get(rowId(t));
      const state: RefTarget['state'] = mineHere ? (handlersOf(mineHere.data).some((h) => here.has(rowId({ service: t.service, list: 'functions', key: h }))) ? 'designed' : 'reference') : 'new-reference';
      if (state === 'new-reference') { header(t.service); want(t, 'reference'); dtosOf(t.service, t.key, 'reference'); }
      refs.set(anchorOfRow(t), { service: t.service, ingress: t.key, bindKey: t.data.bindKey ?? '', label: labelOf(t), state });
    }
  };

  let level: ImportSet['level'];
  if (p.kind === 'ing') {
    const ing = get(p.service!, 'ingress', p.key);
    if (!ing) throw new ImportError('NO_ITEM', `'${i.anchor}' is not in ${i.source}`);
    level = 'endpoint';
    run(ing, true);
  } else {
    if (!get(p.service!, 'header')) throw new ImportError('NO_ITEM', `'${i.anchor}' is not in ${i.source}`);
    level = 'component';
    header(p.service!);
    for (const [list, why] of [['ingress', 'ingress'], ['egress', 'egress'], ['resources', 'resource'], ['channels', 'channel'], ['bindings', 'binding'], ['dto', 'dto']] as const) for (const r of rowsOf(p.service!, list)) {
      want(r, why);
      if (list === 'resources' && r.data.bindKey) storeKeys.add(r.data.bindKey);
      if (list === 'egress') types(r.data.events);
      if (list === 'ingress') types((r.data.events ?? []).map((e: any) => e.type));
    }
  }
  for (const r of i.srcRows) if (r.list === 'schema' && storeKeys.has(r.key.slice(0, r.key.lastIndexOf('|')))) want(r, 'schema');
  for (const t of eventTypes) { const r = get('', 'event_dto', t); if (r) want(r, 'event_dto'); }
  if (!items.size) throw new ImportError('NOTHING_TO_IMPORT', `everything ${i.anchor} brings is already in this design`);
  const access = (s: Set<string>) => { const a = [...s].filter(Boolean); return a.length === 0 ? undefined : a.length === 1 ? a[0] : 'read_write'; };
  return {
    level, items: [...items.values()], alreadyHere: [...already.values()], references: [...refs.values()],
    uses: { ...(handler ? { handler } : {}), calls: [...uses.calls].map(([anchor, label]) => ({ anchor, label })), stores: [...uses.stores].map(([key, s]) => ({ key, ...(access(s) ? { access: access(s) } : {}) })) },
  };
}
