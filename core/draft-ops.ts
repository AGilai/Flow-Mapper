// Draft ops, the pure part. A draft is a list of whole-item ops (upsert | delete) on ItemRows, named by anchors.
//   netOps         the last op per item, in seq order (a service delete wipes the earlier ops of that service)
//   overlayRows    the environment's rows with the ops laid over them: what the environment would look like
//   draftChanges   what the draft changes against the environment (one function for the bar, the review list and /changes)
// Nothing here knows about the database or HTTP.

import { anchorOfRow, parseAnchor, rowOfAnchor } from './anchors.ts';
import { rowId, rowLabel, type ItemRow } from './item-rows.ts';
import { rawHash, same } from './diff/normalise.ts';

export interface DraftOpInput { op: 'upsert' | 'delete'; anchor: string; service?: string; data?: unknown }
/** Where an op's item was imported from (import ops only): the source environment and its service version then. */
export interface OpOrigin { env: string; version: number | null }
export interface DraftOp extends DraftOpInput { seq: number; service: string; list: string; key: string; baseHash: string | null; author: string; byAi: boolean; at: string; origin?: OpOrigin | null }
export type NetOp = DraftOp;
export interface DraftChange { anchor: string; change: 'added' | 'removed' | 'changed'; label: string; under?: string; authors: string[]; at: string; stale: boolean }
export interface DraftChanges { counts: { added: number; removed: number; changed: number }; items: DraftChange[]; authors: string[] }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const isSvcDelete = (o: Pick<DraftOp, 'op' | 'list'>) => o.op === 'delete' && o.list === 'header';
const KEEP = ['version', 'harvestedAt', 'commit'];

/** Shape errors of one op input (empty = fine). The anchor must parse, a field anchor is no item, an upsert needs an object. */
export function validateOpShape(o: unknown): string[] {
  const i = o as DraftOpInput;
  if (!isObj(i)) return ['op must be an object {op, anchor, service?, data?}'];
  const errs: string[] = [];
  if (i.op !== 'upsert' && i.op !== 'delete') errs.push("op must be 'upsert' or 'delete'");
  const p = parseAnchor(i.anchor);
  if (!p) errs.push(`anchor '${String(i.anchor)}' is not valid`);
  else if (p.field !== undefined) errs.push('an op names an item, not a field: drop the #field part');
  if (i.op === 'upsert' && !isObj(i.data)) errs.push('upsert needs data: the whole item as an object');
  if (i.op === 'delete' && i.data !== undefined) errs.push('delete takes no data');
  if (i.service !== undefined && typeof i.service !== 'string') errs.push('service must be a string');
  if ('origin' in i) errs.push('origin is set by import only');
  return errs;
}

/** The row an op input names: {service, list, key}. Throws Error('anchor ...') for a bad anchor. */
export const opRow = (i: DraftOpInput) => rowOfAnchor(i.anchor, i.service);

/** Fold ops in seq order: the last op per item wins; `delete svc:<s>` removes every earlier entry of s. A service deleted and then
 *  created again keeps its delete (the re-created service replaces the old one, it does not merge with it). */
export function netOps(ops: DraftOp[]): NetOp[] {
  const net = new Map<string, NetOp>();
  for (const o of [...ops].sort((a, b) => a.seq - b.seq)) {
    const id = rowId(o);
    if (isSvcDelete(o)) {
      for (const [k, x] of net) if (x.service === o.service) net.delete(k);
      net.set(id, o);
    } else if (o.list === 'header' && net.has(id) && isSvcDelete(net.get(id)!)) net.set(`${id}#after`, o); // keeps the delete in front of the re-creation
    else net.set(o.list === 'header' && net.has(`${id}#after`) ? `${id}#after` : id, o);
  }
  return [...net.values()].sort((a, b) => a.seq - b.seq);
}

const stripKeep = (d: any) => Object.fromEntries(Object.entries(d ?? {}).filter(([k]) => !KEEP.includes(k)));

/** Apply one op to a row map in place (a header delete drops every row of that service). */
export function applyOp(rows: Map<string, ItemRow>, o: Pick<DraftOp, 'op' | 'service' | 'list' | 'key' | 'data'>) {
  const id = rowId(o);
  if (isSvcDelete(o)) { for (const [k, r] of rows) if (r.service === o.service) rows.delete(k); return; }
  if (o.op === 'delete') { rows.delete(id); return; }
  const prev = rows.get(id);
  let data: any = o.data;
  if (o.list === 'header' && prev) data = { ...Object.fromEntries(KEEP.filter((k) => prev.data?.[k] !== undefined).map((k) => [k, prev.data[k]])), ...(o.data as object) };
  rows.set(id, { service: o.service, list: o.list, key: o.key, data });
}

/** The environment as the draft would leave it. */
export function overlayRows(rows: ItemRow[], net: NetOp[]): ItemRow[] {
  const map = new Map(rows.map((r) => [rowId(r), r]));
  for (const o of net) applyOp(map, o);
  return [...map.values()];
}

/** Does the draft's item differ from the environment's? Headers compare whole (group path and details are design content). */
export function differs(list: string, a: unknown, b: unknown): boolean {
  return list === 'header' ? rawHash(a, 'header') !== rawHash(stripKeep(b), 'header') : !same(list, a, b);
}

/** What the draft changes in the environment. Children of an added or removed component are listed (`under`) but not counted. */
export function draftChanges(envRows: ItemRow[], net: NetOp[], all: DraftOp[] = net): DraftChanges {
  const env = new Map(envRows.map((r) => [rowId(r), r]));
  const after = new Map(env);
  for (const o of net) applyOp(after, o);
  const touched = new Map<string, DraftOp>();
  for (const o of net) { touched.set(rowId(o), o); if (isSvcDelete(o)) for (const r of env.values()) if (r.service === o.service && !touched.has(rowId(r))) touched.set(rowId(r), o); }
  const by = new Map<string, DraftOp[]>();
  for (const o of all) by.set(rowId(o), [...(by.get(rowId(o)) ?? []), o]);
  const svcChange = new Map<string, 'added' | 'removed'>();
  for (const [id, r] of after) if (r.list === 'header' && !env.has(id)) svcChange.set(r.service, 'added');
  for (const [id, r] of env) if (r.list === 'header' && !after.has(id)) svcChange.set(r.service, 'removed');
  const items: DraftChange[] = [];
  for (const id of new Set([...env.keys(), ...after.keys()])) {
    const e = env.get(id), a = after.get(id), r = (a ?? e)!;
    const op = touched.get(id);
    if (!op) continue;
    const change = !e ? 'added' : !a ? 'removed' : differs(r.list, a.data, e.data) ? 'changed' : null;
    if (!change) continue;
    const own = by.get(id) ?? [op], mine = rowId(op) === id;
    const under = r.list !== 'header' && r.service && svcChange.get(r.service) ? `svc:${r.service}` : undefined;
    items.push({ anchor: anchorOfRow(r), change, label: rowLabel(r), ...(under ? { under } : {}), authors: [...new Set(own.map((x) => x.author))],
      at: own[own.length - 1].at, stale: mine && (e ? rawHash(e.data, r.list) : null) !== op.baseHash });
  }
  items.sort((x, y) => (x.anchor < y.anchor ? -1 : x.anchor > y.anchor ? 1 : 0));
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const i of items) if (!i.under) counts[i.change]++;
  return { counts, items, authors: [...new Set(items.flatMap((i) => i.authors))] };
}
