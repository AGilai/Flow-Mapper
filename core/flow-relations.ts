// Typed flow-to-flow relations (0.28.2, #50): the rows `flowrel` (anchor rel:<id>, data {from: 'flow:<s>/<i>', to, type, note?}), their id, rules and reading.
// Pure (shared with the browser). A relation joins two entry-point flows of one design environment; contradicts and same-topic are symmetric (stored with from < to).

import { hash53 } from './description.ts';
import { parseAnchor } from './anchors.ts';
import type { ItemRow } from './item-rows.ts';

export const REL_TYPES = ['contradicts', 'variant-of', 'supersedes', 'same-topic'] as const;
export type RelType = typeof REL_TYPES[number];
export const SYMMETRIC: readonly RelType[] = ['contradicts', 'same-topic'];
const ALIASES: Record<string, RelType> = { variant: 'variant-of', variant_of: 'variant-of', same_topic: 'same-topic' };
export const NOTE_MAX = 1000;

export interface FlowRef { service: string; ingress: string }
export interface RelIssue { code: string; message: string; field?: string }
export interface RelData { from: string; to: string; type: RelType; note?: string }
export interface RelationView { id: string; type: RelType; from: FlowRef; to: FlowRef; note?: string; other: FlowRef; direction: 'out' | 'in'; phrase: string }

/** A plan's or a form's name for a type -> the type, or null. */
export const normType = (t: unknown): RelType | null => (typeof t !== 'string' ? null : (REL_TYPES as readonly string[]).includes(t) ? (t as RelType) : ALIASES[t] ?? null);
export const flowAnchor = (f: FlowRef) => `flow:${f.service}/${f.ingress}`;
/** `flow:<s>/<i>` or `{service, ingress}` -> the flow, or null. */
export function flowOf(e: unknown): FlowRef | null {
  if (typeof e === 'string') { const p = parseAnchor(e); return p?.kind === 'flow' && p.field === undefined ? { service: p.service!, ingress: p.key } : null; }
  return e && typeof e === 'object' && typeof (e as any).service === 'string' && typeof (e as any).ingress === 'string' ? { service: (e as any).service, ingress: (e as any).ingress } : null;
}
export const relId = (from: string, to: string, type: RelType) => 'r' + hash53(`${from}|${to}|${type}`);

/** The relation as stored: type by its name, a symmetric one ordered (from < to), its id and anchor. Null when an end or the type is not understood. */
export function relationItem(input: { from: unknown; to: unknown; type: unknown; note?: unknown }): { id: string; data: RelData } | null {
  const a = flowOf(input.from), b = flowOf(input.to), type = normType(input.type);
  if (!a || !b || !type) return null;
  let from = flowAnchor(a), to = flowAnchor(b);
  if (SYMMETRIC.includes(type) && from > to) [from, to] = [to, from];
  const note = typeof input.note === 'string' ? input.note.trim() : '';
  return { id: relId(from, to, type), data: { from, to, type, ...(note ? { note } : {}) } };
}

/** Is `f` an entry point of these rows: an endpoint that exists and is not marked `entryPoint: false`. */
const isEntry = (rows: ItemRow[], f: FlowRef) => rows.some((r) => r.list === 'ingress' && r.service === f.service && r.key === f.ingress && r.data?.entryPoint !== false);

/** The problems of one relation (empty = fine). `id` is the anchor key. */
export function checkRelation(id: string, data: any, rows: ItemRow[]): RelIssue[] {
  const out: RelIssue[] = [];
  const bad = (code: string, message: string, field?: string) => out.push({ code, message, ...(field ? { field } : {}) });
  if (!(REL_TYPES as readonly string[]).includes(data?.type)) bad('BAD_TYPE', `type must be one of ${REL_TYPES.join(', ')}`, 'type');
  const a = flowOf(data?.from), b = flowOf(data?.to);
  if (!a) bad('NO_FLOW', `'${data?.from}' is not a flow (flow:<component>/<endpoint>)`, 'from');
  if (!b) bad('NO_FLOW', `'${data?.to}' is not a flow (flow:<component>/<endpoint>)`, 'to');
  if (a && b) {
    if (flowAnchor(a) === flowAnchor(b)) bad('SAME_FLOW', 'a flow cannot be related to itself', 'to');
    for (const [f, field] of [[a, 'from'], [b, 'to']] as const) if (!isEntry(rows, f)) bad('NO_FLOW', `${flowAnchor(f)} is not an entry point of this design`, field);
  }
  if (data?.note !== undefined && (typeof data.note !== 'string' || data.note.length > NOTE_MAX)) bad('INVALID', `note must be text of at most ${NOTE_MAX} characters`, 'note');
  if (!out.length && id !== relId(data.from, data.to, data.type)) bad('BAD_ID', `rel:${id} does not match its ends and type`);
  return out;
}

const PHRASE: Record<RelType, [string, string]> = {
  contradicts: ['contradicts', 'contradicts'], 'variant-of': ['is a variant of', 'has a variant'],
  supersedes: ['supersedes', 'is superseded by'], 'same-topic': ['same topic as', 'same topic as'],
};
export const phraseOf = (type: RelType, direction: 'out' | 'in') => PHRASE[type][direction === 'out' ? 0 : 1];

/** The relations in `rows` (of one flow, or all), sorted by type then the other flow. Relative to `flow`, `direction` is 'out' when it is the `from` end; with no flow it is 'out' and `other` is the `to` end. */
export function relationsOf(rows: ItemRow[], flow?: FlowRef | null, type?: string | null): RelationView[] {
  const out: RelationView[] = [];
  for (const r of rows) {
    if (r.list !== 'flowrel') continue;
    const from = flowOf(r.data?.from), to = flowOf(r.data?.to);
    if (!from || !to || (type && r.data.type !== type)) continue;
    const isFrom = !flow || (from.service === flow.service && from.ingress === flow.ingress), isTo = !!flow && to.service === flow.service && to.ingress === flow.ingress;
    if (!isFrom && !isTo) continue;
    const direction = isFrom ? 'out' : 'in';
    out.push({ id: r.key, type: r.data.type, from, to, ...(r.data.note ? { note: r.data.note } : {}), other: direction === 'out' ? to : from, direction, phrase: phraseOf(r.data.type, direction) });
  }
  const order = (v: RelationView) => `${REL_TYPES.indexOf(v.type)}|${v.other.service}/${v.other.ingress}`;
  return out.sort((x, y) => (order(x) < order(y) ? -1 : order(x) > order(y) ? 1 : 0));
}

/** Per flow (`<service>/<ingress>`): how many relations of each type touch it, for the Flows list badge and filter. */
export function relationCounts(rows: ItemRow[]): Map<string, Partial<Record<RelType, number>>> {
  const m = new Map<string, Partial<Record<RelType, number>>>();
  for (const v of relationsOf(rows)) for (const f of [v.from, v.to]) {
    const k = `${f.service}/${f.ingress}`, c = m.get(k) ?? {};
    c[v.type] = (c[v.type] ?? 0) + 1; m.set(k, c);
  }
  return m;
}
