// The flow around one channel, as the channel page draws it: one row per real subscription (the
// declarations of every manifest merged, differences named field by field), and a grid of event type
// x destination that says whether each event is handled, filtered out or arrives with no handler.
// Pure. See docs/API.md (channels) and docs/UI-GUIDE.md §3 and §4.

import type { GraphIndex } from './graph-index.ts';
import { linksFrom, linksInto, sid } from './graph-index.ts';
import { handlerFor } from './events.ts';
import { filterAllows, filterLabel, keyMatches, type FilterEvents as Events } from './glob.ts';
import { codeLink, type SourceLink } from './endpoint-info.ts';
import type { Binding, Ingress } from './types.ts';
import { flowSummary, type Summary } from './channel-summary.ts';

export type { Events };
export { filterLabel };
export interface Declaration { service: string; id: string; events: Events; at: SourceLink | null; verified: 'match' | 'drift' | 'code-only' | null }
/** The filter of one subscription. `events` is what to draw: the shared filter, or the union of the claims when they disagree. */
export interface FlowFilter { events: Events; declarations: Declaration[]; agree: boolean; differs: 'filter' | null }
export interface FlowNode { key: string; name: string; kind: string; known: boolean; eventTypes: number }
export interface Consumer { service: string; ingress: string; handler: string; handles: { all: boolean; types: string[] } }
export interface Publisher { service: string; egress: string; events: string[] }
export interface FlowRow {
  id: string;
  /** Upstream channel; null for publishers that send straight into this channel. */
  from: FlowNode | null;
  /** The queue (or other target) this row delivers to. */
  to: FlowNode;
  filter: FlowFilter | null;
  direct: Publisher[];
  consumers: Consumer[];
}
export type CellStatus = 'handled' | 'no-handler' | 'filtered' | 'no-consumer';
export interface Cell { status: CellStatus; handler: string | null; uncertain: boolean; why: string }
export interface GridDestination { rowId: string; queue: { key: string; name: string } | null; consumer: Consumer | null }
export interface DeliveryGrid {
  destinations: GridDestination[];
  rows: { type: string; producers: string[]; cells: Cell[] }[];
}
export interface ChannelFlow {
  /** fanout: this channel sends to subscriptions (topic, bus, exchange). inbound: this channel is fed by others (queue). */
  layout: 'fanout' | 'inbound';
  rows: FlowRow[];
  /** Services that read this channel itself (a queue's consumers); empty for a topic. */
  consumers: Consumer[];
  grid: DeliveryGrid;
  summary: Summary;
}

const FANOUT_KINDS = ['sns-topic', 'eventbridge-bus', 'amqp-exchange'];
const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
const norm = (e: Events | undefined): Events => (!e || e === '*' ? '*' : [...e]);
const sameFilter = (a: Events, b: Events) => JSON.stringify(a === '*' ? a : [...a].sort()) === JSON.stringify(b === '*' ? b : [...b].sort());

const allows = (events: Events, type: string) => events === '*' || filterAllows(events, type);

function mergeFilter(bs: Binding[], g: GraphIndex): FlowFilter {
  const declarations: Declaration[] = bs.map((b) => ({
    service: b.service, id: b.id, events: norm(b.events),
    at: g.services.has(b.service) ? codeLink(g.services.get(b.service)!, b.source) : null, verified: b.provenance?.verified ?? null,
  }));
  const agree = declarations.every((d) => sameFilter(d.events, declarations[0].events));
  const union: Events = agree ? declarations[0].events
    : declarations.some((d) => d.events === '*') ? '*' : [...new Set(declarations.flatMap((d) => d.events as string[]))];
  return { events: union, declarations, agree, differs: agree ? null : 'filter' };
}

function consumersOf(g: GraphIndex, key: string): Consumer[] {
  const seen = new Set<string>();
  const out: Consumer[] = [];
  for (const l of linksFrom(g, { type: 'channel', key })) {
    if (l.to.type !== 'ingress') continue;
    const i: Ingress = g.ingress.get(sid(l.to.service, l.to.id))!;
    if (seen.has(sid(i.service, i.id))) continue;
    seen.add(sid(i.service, i.id));
    const types = (i.events ?? []).map((e) => e.type);
    out.push({ service: i.service, ingress: i.id, handler: i.handler, handles: { all: !types.length || types.includes('*'), types: types.filter((t) => t !== '*') } });
  }
  return out;
}

/** Event types published into a channel, directly or through channels that feed it, with who publishes them. */
function eventsInto(g: GraphIndex, key: string, seen = new Set<string>()): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  if (seen.has(key)) return out;
  seen.add(key);
  for (const l of linksInto(g, { type: 'channel', key })) {
    if (l.from.type === 'egress') {
      const e = g.egress.get(sid(l.from.service, l.from.id))!;
      for (const t of e.events ?? []) out.set(t, (out.get(t) ?? new Set()).add(e.service));
    } else if (l.from.type === 'channel') {
      for (const [t, who] of eventsInto(g, l.from.key, seen)) out.set(t, new Set([...(out.get(t) ?? []), ...who]));
    }
  }
  return out;
}

function publishersInto(g: GraphIndex, key: string): Publisher[] {
  return linksInto(g, { type: 'channel', key }).filter((l) => l.from.type === 'egress').map((l) => {
    const e = g.egress.get(sid((l.from as any).service, (l.from as any).id))!;
    return { service: e.service, egress: e.id, events: e.events ?? [] };
  });
}

function node(g: GraphIndex, key: string, types?: number): FlowNode {
  const c = g.channels.get(key);
  return { key, name: c?.name ?? key, kind: c?.kind ?? 'other', known: !!c, eventTypes: types ?? 0 };
}

/** One merged subscription row per (from, to). */
function mergedBindings(g: GraphIndex, key: string, dir: 'out' | 'in'): Map<string, { from: string; to: string; bs: Binding[] }> {
  const groups = new Map<string, { from: string; to: string; bs: Binding[] }>();
  const add = (from: string, to: string, b: Binding) => {
    const k = `${from}\u0000${to}`;
    if (!groups.has(k)) groups.set(k, { from, to, bs: [] });
    groups.get(k)!.bs.push(b);
  };
  for (const b of g.model.bindings) {
    if (dir === 'out') { if (keyMatches(b.from, b.match, key)) add(key, b.to, b); }
    else if (b.to === key) {
      const sources = [...g.channels.keys()].filter((c) => keyMatches(b.from, b.match, c));
      for (const s of sources.length ? sources : [b.from]) add(s, key, b);
    }
  }
  return groups;
}

type State = 'yes' | 'no' | 'maybe';
const stateOf = (f: FlowFilter | null, type: string): State => {
  if (!f) return 'yes';
  const ok = f.declarations.filter((d) => allows(d.events, type)).length;
  return ok === f.declarations.length ? 'yes' : ok ? 'maybe' : 'no';
};

const list = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

function cellFor(rows: { row: FlowRow; incoming: Set<string> }[], consumer: Consumer | null, g: GraphIndex, type: string): Cell {
  if (!consumer) return { status: 'no-consumer', handler: null, uncertain: false, why: 'No harvested service reads this queue.' };
  const relevant = rows.filter((r) => r.incoming.has(type));
  const states = relevant.map((r) => stateOf(r.row.filter, type));
  const state: State = states.includes('yes') ? 'yes' : states.includes('maybe') ? 'maybe' : 'no';
  const handler = handlerFor(g.ingress.get(sid(consumer.service, consumer.ingress))!, type);
  if (state === 'no') {
    const f = relevant.find((r) => r.row.filter)?.row.filter;
    return { status: 'filtered', handler: null, uncertain: false, why: f ? `The filter (${filterLabel(f.events)}) does not let it through.` : 'It is not sent here.' };
  }
  const base = { handler, uncertain: state === 'maybe' };
  let why = '';
  if (state === 'maybe') {
    const f = relevant.map((r) => r.row.filter!).find((x) => !x.agree)!;
    const yes = f.declarations.filter((d) => allows(d.events, type)), no = f.declarations.filter((d) => !allows(d.events, type));
    const named = (ds: Declaration[]) => list(ds.map((d) => `${d.service}'s “${filterLabel(d.events)}”`));
    why = `if ${named(yes)} is right. With ${named(no)} it is not delivered.`;
  }
  if (handler === null) return { status: 'no-handler', ...base, why: why || `${consumer.service} lists the event types it handles, and this is not one of them.` };
  return { status: 'handled', ...base, why };
}

export function channelFlow(g: GraphIndex, key: string, unboundReasons: string[] = []): ChannelFlow {
  const c = g.channels.get(key)!;
  const out = mergedBindings(g, key, 'out');
  const layout: ChannelFlow['layout'] = out.size || FANOUT_KINDS.includes(c.kind) ? 'fanout' : 'inbound';
  const eventCount = (k: string) => eventsInto(g, k).size;

  const rows: FlowRow[] = [];
  const incomingOf = new Map<string, Set<string>>();
  if (layout === 'fanout') {
    const mine = new Set(eventsInto(g, key).keys());
    for (const { from, to, bs } of out.values()) {
      const row: FlowRow = { id: `sub-${slug(from)}-${slug(to)}`, from: node(g, from), to: node(g, to, eventCount(to)), filter: mergeFilter(bs, g), direct: [], consumers: consumersOf(g, to) };
      rows.push(row);
      incomingOf.set(row.id, mine);
    }
  } else {
    for (const { from, to, bs } of mergedBindings(g, key, 'in').values()) {
      const row: FlowRow = { id: `sub-${slug(from)}-${slug(to)}`, from: node(g, from), to: node(g, to, eventCount(to)), filter: mergeFilter(bs, g), direct: [], consumers: consumersOf(g, to) };
      rows.push(row);
      incomingOf.set(row.id, new Set(eventsInto(g, from).keys()));
    }
    const direct = publishersInto(g, key);
    if (direct.length) {
      const row: FlowRow = { id: `sub-direct-${slug(key)}`, from: null, to: node(g, key, eventCount(key)), filter: null, direct, consumers: consumersOf(g, key) };
      rows.push(row);
      incomingOf.set(row.id, new Set(direct.flatMap((p) => p.events)));
    }
  }

  rows.sort((a, b) => a.to.name.localeCompare(b.to.name) || (a.from?.name ?? '').localeCompare(b.from?.name ?? ''));

  // Destinations: one column per (queue, consumer). A queue nobody reads still gets a column.
  const dests: { rows: { row: FlowRow; incoming: Set<string> }[]; dest: GridDestination }[] = [];
  const seenDest = new Map<string, number>();
  if (layout === 'fanout') {
    for (const row of rows) {
      const cs: (Consumer | null)[] = row.consumers.length ? row.consumers : [null];
      for (const consumer of cs) dests.push({ rows: [{ row, incoming: incomingOf.get(row.id)! }], dest: { rowId: row.id, queue: { key: row.to.key, name: row.to.name }, consumer } });
    }
  } else {
    const cs: (Consumer | null)[] = consumersOf(g, key).length ? consumersOf(g, key) : [null];
    for (const consumer of cs) {
      const k = consumer ? sid(consumer.service, consumer.ingress) : '';
      if (seenDest.has(k)) continue;
      seenDest.set(k, dests.length);
      dests.push({ rows: rows.map((row) => ({ row, incoming: incomingOf.get(row.id)! })), dest: { rowId: rows[0]?.id ?? '', queue: { key, name: c.name ?? key }, consumer } });
    }
    if (!rows.length) dests.length = 0;
  }

  const types = new Map<string, Set<string>>();
  if (layout === 'fanout') for (const [t, who] of eventsInto(g, key)) types.set(t, new Set(who));
  for (const r of rows) for (const t of incomingOf.get(r.id)!) {
    const who = layout === 'fanout' ? eventsInto(g, key).get(t) : r.from ? eventsInto(g, r.from.key).get(t) : new Set(r.direct.filter((p) => p.events.includes(t)).map((p) => p.service));
    types.set(t, new Set([...(types.get(t) ?? []), ...(who ?? [])]));
  }
  const grid: DeliveryGrid = {
    destinations: dests.map((d) => d.dest),
    rows: [...types.keys()].sort().map((type) => ({
      type, producers: [...types.get(type)!].sort(),
      cells: dests.map((d) => (d.rows.some((r) => r.incoming.has(type)) ? cellFor(d.rows, d.dest.consumer, g, type) : { status: 'filtered' as const, handler: null, uncertain: false, why: 'It is not sent here.' })),
    })),
  };

  const publishers = layout === 'fanout' ? publishersInto(g, key) : [];
  return { layout, rows, consumers: consumersOf(g, key), grid, summary: flowSummary({ name: c.name ?? key, kind: c.kind, layout, rows, grid, publishers, unbound: unboundReasons }) };
}
