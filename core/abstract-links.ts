// Abstract links: a link drawn at subsystem level (link:<id>), kept as design content until a call realises it.
//   ends:    from = grp: | svc: | egr: | ing:   to = grp: | svc: | ing:
//   states:  abstract (both ends subsystems) | partial (one end narrowed) | ready (both ends endpoints, no call yet)
//            | refined (calls realise it, all exist and reach the `to` scope) | broken (an end or a refining call is gone)
// Pure: the graph and the rows come in as arguments.

import { parseAnchor } from './anchors.ts';
import { downstreamIngress, sid, type GraphIndex } from './graph-index.ts';
import type { ItemRow } from './item-rows.ts';
import { callInfo, membershipOf, topOf } from './subsystems.ts';
import type { Mode, Transport } from './types.ts';

export interface LinkData {
  name: string;
  from: string; to: string;
  mode?: Mode; transport?: Transport | null; description?: string; doc?: unknown;
  refinedBy?: { service: string; egress: string }[];
}
export interface LinkEnd { anchor: string; level: 'subsystem' | 'component' | 'endpoint'; subsystem: string; service?: string; item?: string; missing?: true }
export interface AbstractView {
  id: string; name: string; from: LinkEnd; to: LinkEnd; mode?: Mode; transport?: Transport | null; description?: string;
  state: 'abstract' | 'partial' | 'ready' | 'refined' | 'broken';
  problems: string[];
  refinedBy: { service: string; egress: string; to?: { service: string; ingress: string } }[];
  /** The roll-up line the refining calls count in (state refined, calls across two subsystems). */
  line?: string;
}
export interface LinkIssue { code: string; message: string; field?: string }

export const LINK_ID = /^[a-z0-9][a-z0-9-]{0,62}$/;
const TRANSPORTS = ['http', 'rpc', 'grpc', 'sns', 'sqs', 'amqp', 'eventbridge', 'cron', 'socket', 'event', 'other', 'undecided'];
const FROM_KINDS = ['grp', 'svc', 'egr', 'ing'], TO_KINDS = ['grp', 'svc', 'ing'];

/** What links need to know about an environment: which subsystems, components and endpoints exist, and each component's subsystem. */
export interface World { subKeys: Set<string>; svc: Map<string, string>; egress: Set<string>; ingress: Set<string> }

const worlds = new WeakMap<ItemRow[], World>();
export function worldOfRows(rows: ItemRow[]): World {
  const hit = worlds.get(rows);
  if (hit) return hit;
  const w: World = { subKeys: new Set(), svc: new Map(), egress: new Set(), ingress: new Set() };
  for (const r of rows) {
    if (r.list === 'subsystem') w.subKeys.add(topOf(r.key));
    else if (r.list === 'header') w.svc.set(r.service, topOf(r.data?.groupPath));
    else if (r.list === 'egress') w.egress.add(`${r.service}/${r.key}`);
    else if (r.list === 'ingress') w.ingress.add(`${r.service}/${r.key}`);
  }
  for (const t of w.svc.values()) if (t) w.subKeys.add(t);
  worlds.set(rows, w);
  return w;
}
export function worldOfGraph(g: GraphIndex, subRows: ItemRow[]): World {
  const svc = membershipOf(g.model.services);
  return { subKeys: new Set([...subRows.map((r) => topOf(r.key)), ...[...svc.values()].filter(Boolean)]), svc,
    egress: new Set(g.model.egress.map((e) => `${e.service}/${e.id}`)), ingress: new Set(g.model.ingress.map((e) => `${e.service}/${e.id}`)) };
}

export function endOf(anchor: string, w: World): LinkEnd {
  const p = parseAnchor(anchor);
  if (!p) return { anchor, level: 'component', subsystem: '', missing: true };
  if (p.kind === 'grp') return { anchor, level: 'subsystem', subsystem: p.key, ...(w.subKeys.has(topOf(p.key)) ? {} : { missing: true as const }) };
  const item = p.kind === 'svc' ? undefined : p.key;
  const exists = p.kind === 'svc' ? w.svc.has(p.service!) : (p.kind === 'egr' ? w.egress : w.ingress).has(`${p.service}/${p.key}`);
  return { anchor, level: p.kind === 'svc' ? 'component' : 'endpoint', subsystem: w.svc.get(p.service!) ?? '', service: p.service, ...(item ? { item } : {}), ...(exists ? {} : { missing: true as const }) };
}

/** Is the scope `inner` within the scope `outer`? grp:X holds the components whose subsystem is X and their endpoints; svc:Y its endpoints. */
export function inside(outer: string, inner: string, w: World): boolean {
  if (outer === inner) return true;
  const o = parseAnchor(outer), i = parseAnchor(inner);
  if (!o || !i) return false;
  if (o.kind === 'grp') return i.kind === 'grp' ? topOf(i.key) === topOf(o.key) && i.key.startsWith(`${o.key}/`) : !!i.service && (i.kind === 'svc' || i.kind === 'egr' || i.kind === 'ing') && w.svc.get(i.service) === topOf(o.key);
  if (o.kind === 'svc') return (i.kind === 'egr' || i.kind === 'ing') && i.service === o.service;
  return false;
}

/** The problems of one link's data against the rows (empty = fine). `id` is the anchor key. */
export function checkLink(id: string, data: any, rows: ItemRow[]): LinkIssue[] {
  const out: LinkIssue[] = [];
  const bad = (code: string, message: string, field?: string) => out.push({ code, message, ...(field ? { field } : {}) });
  if (!LINK_ID.test(id)) bad('BAD_NAME', `link id '${id}' must be lowercase letters, digits and '-' (at most 63 characters)`, 'id');
  if (!data || typeof data !== 'object' || Array.isArray(data)) { bad('INVALID', 'a link is {name, from, to, mode?, transport?, description?, refinedBy?}'); return out; }
  if (typeof data.name !== 'string' || !data.name.trim() || data.name.length > 200) bad('INVALID', 'name must be 1 to 200 characters', 'name');
  const w = worldOfRows(rows);
  const ends = (field: 'from' | 'to', kinds: string[]) => {
    const p = parseAnchor(data[field]);
    if (!p || p.field !== undefined || !kinds.includes(p.kind)) { bad('BAD_END', `${field} must be one of ${kinds.map((k) => `${k}:`).join(', ')} (got ${JSON.stringify(data[field])})`, field); return; }
    if (endOf(data[field], w).missing) bad('NO_END', `${field} '${data[field]}' does not exist in this design`, field);
  };
  ends('from', FROM_KINDS); ends('to', TO_KINDS);
  if (data.from !== undefined && data.from === data.to) bad('SAME_END', 'from and to are the same', 'to');
  if (data.mode !== undefined && data.mode !== null && data.mode !== 'sync' && data.mode !== 'async') bad('INVALID', "mode must be 'sync', 'async' or absent", 'mode');
  if (data.transport !== undefined && data.transport !== null && !TRANSPORTS.includes(data.transport)) bad('INVALID', `transport must be one of ${TRANSPORTS.join(', ')} or null`, 'transport');
  if (data.description !== undefined && (typeof data.description !== 'string' || data.description.length > 4000)) bad('INVALID', 'description must be text of at most 4000 characters', 'description');
  if (data.refinedBy !== undefined) {
    if (!Array.isArray(data.refinedBy) || data.refinedBy.length > 20) bad('INVALID', 'refinedBy is a list of at most 20 {service, egress}', 'refinedBy');
    else for (const r of data.refinedBy) if (!w.egress.has(`${r?.service}/${r?.egress}`)) bad('NO_END', `refinedBy: egress '${r?.egress}' of '${r?.service}' does not exist in this design`, 'refinedBy');
  }
  return out;
}

const labelOf = (e: LinkEnd) => (e.level === 'subsystem' ? `subsystem ${e.anchor.slice(4)}` : e.level === 'component' ? `component ${e.service}` : `${e.anchor.slice(0, 3) === 'egr' ? 'call' : 'endpoint'} ${e.service}/${e.item}`);

/** Every link of `linkRows` as a view: its ends, state and refinement against the graph. Sorted by id. */
export function linkViews(g: GraphIndex, linkRows: ItemRow[], w: World): AbstractView[] {
  const out: AbstractView[] = [];
  for (const r of [...linkRows].sort((a, b) => (a.key < b.key ? -1 : 1))) {
    const d = r.data as LinkData, from = endOf(d.from, w), to = endOf(d.to, w), problems: string[] = [];
    if (from.missing) problems.push(`${labelOf(from)} no longer exists`);
    if (to.missing) problems.push(`${labelOf(to)} no longer exists`);
    const refinedBy: AbstractView['refinedBy'] = [];
    let line: string | undefined;
    for (const rb of d.refinedBy ?? []) {
      const e = g.egress.get(sid(rb.service, rb.egress));
      if (!e) { problems.push(`call ${rb.service}/${rb.egress} no longer exists`); refinedBy.push({ ...rb }); continue; }
      const hit = downstreamIngress(g, { type: 'egress', service: e.service, id: e.id }).find((x) => inside(d.to, `ing:${x.ingress.service}/${x.ingress.id}`, w));
      if (!hit) { problems.push(`${rb.egress} no longer reaches ${labelOf(to)}`); refinedBy.push({ ...rb }); continue; }
      refinedBy.push({ ...rb, to: { service: hit.ingress.service, ingress: hit.ingress.id } });
      const c = callInfo(e, hit.ingress, hit.via.length > 0, w.svc);
      if (!line && c.from !== c.to) line = c.line;
    }
    const state: AbstractView['state'] = problems.length ? 'broken' : refinedBy.length ? 'refined'
      : from.level === 'subsystem' && to.level === 'subsystem' ? 'abstract' : from.level === 'endpoint' && to.level === 'endpoint' ? 'ready' : 'partial';
    out.push({ id: r.key, name: d.name, from, to, ...(d.mode ? { mode: d.mode } : {}), ...(d.transport !== undefined ? { transport: d.transport } : {}), ...(d.description ? { description: d.description } : {}),
      state, problems, refinedBy, ...(state === 'refined' && line ? { line } : {}) });
  }
  return out;
}
