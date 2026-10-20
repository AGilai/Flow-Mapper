// The async index under a diagram: one row per consumer flow, grouped by the publish that starts it (and by alt
// branch). Pure, no DOM. Built from the whole trace once; each row knows its own flow's messages, so a card can
// draw that flow with the same lane rules, and the flows it starts become nested groups.

import { scanLane, subflowRanges } from './flow-scan.js';
import { publishLabel } from './flow-lane.js';

/** "1 step", "3 steps". */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "1 flow", "3 flows". */
export const flowsLabel = (n) => plural(n, 'flow');
/** An identifier cut into pieces that may break after - . _ / : (the DOM puts <wbr> between them). */
export const idParts = (t) => String(t).split(/(?<=[-._/:])/);

const handlerOf = (m) => m.target?.fn ?? m.label.match(/→\s*(.+)$/)?.[1] ?? 'no handler';

/** "3 calls · 2 stores · publishes sns": what a flow does, from its lane messages. */
export function summaryOf(msgs) {
  const { lane, publishes } = scanLane(msgs);
  const calls = lane.filter((i) => msgs[i].kind === 'call').length;
  const stores = new Set(lane.filter((i) => msgs[i].kind === 'resource').map((i) => msgs[i].store));
  const pubs = [...new Set(publishes.map((p) => msgs[p.i].transport))];
  const parts = [];
  parts.push(`${calls} ${calls === 1 ? 'call' : 'calls'}`);
  if (stores.size) parts.push(`${stores.size} ${stores.size === 1 ? 'store' : 'stores'}`);
  if (pubs.length) parts.push(`publishes ${pubs.join(', ')}`);
  return parts.join(' · ');
}

/**
 * asyncTree(messages) -> { groups, rows, byLabel }
 * group: { pub: index of the publish, topic, event, branch: {n, of, condition}|null, rows: [] }
 * row: { label: '1' | '3.1', i: delivery index, queue, service, ingress, handler, noHandler, transport,
 *        seenIn: label | null, suspect, range: {start,end}|null (what the consumer does), msgs: [...] (delivery + range),
 *        summary, groups: nested groups (only for a row that is not "seen") }
 * A delivery is "seen" when its consumer + handler already has a row in another publish (or the trace marks it a
 * repeat); the same consumer + handler twice in ONE publish is a "suspect" row (still a normal row).
 */
export function asyncTree(messages) {
  const rows = [], firstOf = new Map(), byIndex = new Map();
  const groupsIn = (lo, hi, prefix, scopeMsgs) => {
    const { publishes } = scanLane(messages, lo, hi);
    const groups = [];
    let n = 0;
    for (const p of publishes) {
      const pm = messages[p.i];
      const group = { pub: p.i, topic: pm.to.slice(3), event: publishLabel(pm), transport: pm.transport,
        branch: pm.alt ? { n: pm.alt.branch, of: pm.alt.of, condition: pm.condition ?? null } : null, rows: [] };
      const ranges = subflowRanges(messages, p);
      const inGroup = new Map();
      for (const d of p.delivers) {
        const m = messages[d];
        const label = prefix ? `${prefix}.${++n}` : String(++n);
        const key = `${m.target?.service ?? m.to}|${m.target?.ingress ?? ''}|${handlerOf(m)}`;
        const noHandler = !!m.unhandled || !m.target?.ingress || m.broken;
        const r = { label, i: d, queue: m.from.slice(3), service: m.target?.service ?? m.to.replace(/^svc:/, ''), ingress: m.target?.ingress ?? null,
          handler: handlerOf(m), noHandler, transport: m.transport, seenIn: null, suspect: false, range: null, msgs: [m], summary: '', groups: [], key, matched: m.matched ?? null };
        if (inGroup.has(key)) r.suspect = true;
        else inGroup.set(key, label);
        const repeat = m.repeatOf ? byIndex.get(m.repeatOf - 1) : null;
        const earlier = firstOf.get(key);
        if (!r.suspect && (repeat || (m.repeatOf && !noHandler) || (earlier && earlier.group !== group))) r.seenIn = (repeat ?? earlier)?.label ?? 'earlier';
        byIndex.set(d, r); rows.push(r); group.rows.push(r);
        if (!firstOf.has(key)) firstOf.set(key, { label, group });
        if (r.seenIn || noHandler) continue;
        const rg = ranges.get(d);
        if (!rg || rg.start > rg.end) { r.msgs = [m]; r.summary = summaryOf(r.msgs); continue; }
        r.range = rg;
        r.msgs = [m, ...messages.slice(rg.start, rg.end + 1)];
        r.summary = summaryOf(r.msgs);
        r.groups = groupsIn(rg.start, rg.end, label);
      }
      groups.push(group);
    }
    return groups;
  };
  const groups = groupsIn(0, messages.length - 1, '');
  return { groups, rows, byLabel: new Map(rows.map((r) => [r.label, r])) };
}

/** Counts for the heading: deliveries, distinct consumers, publishes (groups, all levels not counted). */
export function indexStats(tree) {
  const distinct = tree.rows.filter((r) => !r.seenIn && !r.noHandler);
  return { deliveries: tree.rows.length, distinct: distinct.length, publishes: tree.groups.length, openable: distinct.filter((r) => r.ingress) };
}

/** The group of a publish message (by message index), anywhere in the tree. */
export function groupOf(tree, pubIndex) {
  const find = (groups) => { for (const g of groups) { if (g.pub === pubIndex) return g; for (const r of g.rows) { const f = find(r.groups); if (f) return f; } } return null; };
  return find(tree.groups);
}
