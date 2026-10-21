// The subsystem level of a design as a graph: every call between components rolled up by (from subsystem, to subsystem, transport, mode),
// the abstract links drawn on top, and per-box totals. One component belongs to one subsystem, so every call is counted once.
// Cost O(S + E + P + L*R); it does not call systemGraph (that builds event reports per channel). Memoised per graph and rows.

import { downstreamIngress, type GraphIndex } from './graph-index.ts';
import { refKey } from './resolve.ts';
import type { ItemRow } from './item-rows.ts';
import { linkViews, worldOfGraph, type AbstractView } from './abstract-links.ts';
import { callInfo, lineId, membershipOf, subsystemsOf, type SubsystemInfo } from './subsystems.ts';
import type { Mark } from './diff/index.ts';
import type { Mode, Transport } from './types.ts';

export interface RolledCall { from: { service: string; egress: string }; to: { service: string; ingress: string }; bindKey: string; via: string[] }
export interface RollLine { id: string; from: string; to: string; transport: Transport; mode: Mode; count: number; calls: RolledCall[]; links: string[] }
export interface SubsystemBox extends SubsystemInfo { internal: number; out: number; in: number; dangling: number }
export interface SubsystemMap { boxes: SubsystemBox[]; lines: RollLine[]; abstract: AbstractView[]; notSet: boolean }

const memo = new WeakMap<GraphIndex, { subRows: ItemRow[]; linkRows: ItemRow[]; out: SubsystemMap }>();
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** `subRows`: the `subsystem` rows, `linkRows`: the `link` rows (both may be empty: derived subsystems, no links). */
export function rollUp(g: GraphIndex, subRows: ItemRow[], linkRows: ItemRow[]): SubsystemMap {
  const hit = memo.get(g);
  if (hit && hit.subRows === subRows && hit.linkRows === linkRows) return hit.out;
  const m = membershipOf(g.model.services), infos = subsystemsOf(subRows, g.model.services);
  const order = new Map(infos.map((s, i) => [s.key, i]));
  order.set('', infos.length);
  const boxes = new Map<string, SubsystemBox>(infos.map((s) => [s.key, { ...s, internal: 0, out: 0, in: 0, dangling: 0 }]));
  const box = (k: string) => boxes.get(k) ?? boxes.set(k, { key: k, label: k || 'Not set', icon: null, order: order.get(k) ?? infos.length, derived: true, components: [], internal: 0, out: 0, in: 0, dangling: 0 }).get(k)!;
  const lines = new Map<string, RollLine>();
  for (const e of g.model.egress) {
    const down = downstreamIngress(g, { type: 'egress', service: e.service, id: e.id });
    if (!down.length) { box(m.get(e.service) ?? '').dangling++; continue; }
    for (const d of down) {
      const c = callInfo(e, d.ingress, d.via.length > 0, m);
      if (c.from === c.to) { box(c.from).internal++; continue; }
      box(c.from).out++; box(c.to).in++;
      const line = lines.get(c.line) ?? lines.set(c.line, { id: c.line, from: c.from, to: c.to, transport: c.transport, mode: c.mode, count: 0, calls: [], links: [] }).get(c.line)!;
      line.count++;
      line.calls.push({ from: { service: e.service, egress: e.id }, to: { service: d.ingress.service, ingress: d.ingress.id }, bindKey: e.bindKey, via: d.via.map(refKey) });
    }
  }
  const abstract = linkViews(g, linkRows, worldOfGraph(g, subRows));
  for (const v of abstract) if (v.state === 'refined' && v.line) { v.line = lines.has(v.line) ? v.line : undefined; if (v.line) lines.get(v.line)!.links.push(v.id); }
  // "Not set" is a box only when one of its components takes part in a call (the loop above made it then).
  const notSet = boxes.has('');
  if (notSet) boxes.get('')!.components = g.model.services.filter((s) => !m.get(s.name)).map((s) => ({ name: s.name, kind: s.kind })).sort((a, b) => cmp(a.name, b.name));
  const sorted = [...lines.values()].sort((a, b) => (order.get(a.from) ?? 0) - (order.get(b.from) ?? 0) || (order.get(a.to) ?? 0) - (order.get(b.to) ?? 0) || cmp(a.transport, b.transport) || cmp(a.mode, b.mode));
  for (const l of sorted) l.calls.sort((a, b) => cmp(a.from.service, b.from.service) || cmp(a.from.egress, b.from.egress) || cmp(a.to.service, b.to.service) || cmp(a.to.ingress, b.to.ingress));
  const out: SubsystemMap = { boxes: [...boxes.values()].sort((a, b) => (order.get(a.key) ?? a.order) - (order.get(b.key) ?? b.order)), lines: sorted, abstract, notSet };
  memo.set(g, { subRows, linkRows, out });
  return out;
}

/** The mark of a roll-up line, from the marks of the calls under it (`egr:` anchors): new when every call is new, changed when some is new or changed. */
export function lineMark(line: RollLine, marks: Record<string, { mark: Mark }>): 'new' | 'changed' | null {
  const ms = line.calls.map((c) => marks[`egr:${c.from.service}/${c.from.egress}`]?.mark);
  if (ms.length && ms.every((x) => x === 'new')) return 'new';
  return ms.some((x) => x === 'new' || x === 'changed') ? 'changed' : null;
}
export { lineId };
