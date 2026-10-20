// The flow around one channel, as the channel page draws it: one row per real subscription (the
// declarations of every manifest merged, differences named field by field), and a grid of event type
// x destination that says whether each event is handled, filtered out or arrives with no handler.
// Pure. See docs/API.md (channels) and docs/UI-GUIDE.md §3 and §4.

import type { GraphIndex } from './graph-index.ts';
import { downstreamIngress, linksFrom, linksInto, sid } from './graph-index.ts';
import { handlerFor, passes } from './events.ts';
import { refKey } from './resolve.ts';
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
/** `possible` are event types the publisher may send (it could not tell which of several). */
export interface Publisher { service: string; egress: string; events: string[]; possible: string[] }
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
/** `possible`: the event type is only a candidate (the publisher could not say which of several it sends). */
export interface Cell { status: CellStatus; handler: string | null; uncertain: boolean; why: string; possible?: boolean }
export interface GridDestination { rowId: string; queue: { key: string; name: string } | null; consumer: Consumer | null }
export interface DeliveryGrid {
  destinations: GridDestination[];
  rows: { type: string; producers: string[]; possible?: boolean; cells: Cell[] }[];
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

export function mergeFilter(bs: Binding[], g: GraphIndex): FlowFilter {
  const declarations: Declaration[] = bs.map((b) => ({
    service: b.service, id: b.id, events: norm(b.events),
    at: g.services.has(b.service) ? codeLink(g.services.get(b.service)!, b.source) : null, verified: b.provenance?.verified ?? null,
  }));
  const agree = declarations.every((d) => sameFilter(d.events, declarations[0].events));
  const union: Events = agree ? declarations[0].events
    : declarations.some((d) => d.events === '*') ? '*' : [...new Set(declarations.flatMap((d) => d.events as string[]))];
  return { events: union, declarations, agree, differs: agree ? null : 'filter' };
}

/** Services that read a channel. `transitive`: also through topics or buses it forwards to. */
function consumersOf(g: GraphIndex, key: string, transitive = false): Consumer[] {
  const seen = new Set<string>();
  const out: Consumer[] = [];
  const ingresses: Ingress[] = transitive
    ? downstreamIngress(g, { type: 'channel', key }).map((x) => x.ingress)
    : linksFrom(g, { type: 'channel', key }).flatMap((l) => (l.to.type === 'ingress' ? [g.ingress.get(sid(l.to.service, l.to.id))!] : []));
  for (const i of ingresses) {
    if (seen.has(sid(i.service, i.id))) continue;
    seen.add(sid(i.service, i.id));
    const types = (i.events ?? []).map((e) => e.type);
    out.push({ service: i.service, ingress: i.id, handler: i.handler, handles: { all: !types.length || types.includes('*'), types: types.filter((t) => t !== '*') } });
  }
  return out;
}

/** Event types that reach a channel, with who publishes each, split into confirmed and only-possible. */
interface EvSets { confirmed: Map<string, Set<string>>; possible: Map<string, Set<string>> }
export const candidatesOf = (e: { events?: string[]; unresolved?: { what: string; candidates?: string[] }[] }) =>
  (e.unresolved ?? []).filter((u) => u.what === 'event').flatMap((u) => u.candidates ?? []).filter((t) => !e.events?.includes(t));
const add = (m: Map<string, Set<string>>, t: string, who: Iterable<string>) => m.set(t, new Set([...(m.get(t) ?? []), ...who]));

function evSets(g: GraphIndex, key: string, seen: Set<string>): EvSets {
  const out: EvSets = { confirmed: new Map(), possible: new Map() };
  if (seen.has(key)) return out;
  const path = new Set(seen).add(key);
  for (const l of linksInto(g, { type: 'channel', key })) {
    if (l.from.type === 'egress') {
      const e = g.egress.get(sid(l.from.service, l.from.id))!;
      for (const t of e.events ?? []) add(out.confirmed, t, [e.service]);
      for (const t of candidatesOf(e)) add(out.possible, t, [e.service]);
    } else if (l.from.type === 'channel') {
      const up = evSets(g, l.from.key, path);
      for (const [t, who] of up.confirmed) if (passes(g, l, t)) add(out.confirmed, t, who);
      for (const [t, who] of up.possible) if (passes(g, l, t)) add(out.possible, t, who);
    }
  }
  for (const t of out.confirmed.keys()) out.possible.delete(t);
  return out;
}

/** What one call computes more than once is remembered here. */
interface Ctx { g: GraphIndex; sets: Map<string, EvSets>; reach: Map<string, Set<string>> }
const eventsInto = (c: Ctx, key: string): EvSets => {
  if (!c.sets.has(key)) c.sets.set(key, evSets(c.g, key, new Set()));
  return c.sets.get(key)!;
};
/** Every event type into a channel: type -> {who, possible}. */
function typesInto(c: Ctx, key: string): Map<string, { who: Set<string>; possible: boolean }> {
  const s = eventsInto(c, key);
  const out = new Map<string, { who: Set<string>; possible: boolean }>();
  for (const [t, who] of s.confirmed) out.set(t, { who, possible: false });
  for (const [t, who] of s.possible) out.set(t, { who, possible: true });
  return out;
}

/** Ingress (service:id) an event type reaches from a channel, applying the filters of every hop. */
function reach(c: Ctx, key: string, event: string): Set<string> {
  const k = `${key}\u0000${event}`;
  if (c.reach.has(k)) return c.reach.get(k)!;
  const out = new Set<string>();
  const seen = new Set<string>();
  const walk = (r: Parameters<typeof linksFrom>[1]) => {
    for (const l of linksFrom(c.g, r)) {
      if (!passes(c.g, l, event)) continue;
      const rk = refKey(l.to);
      if (seen.has(rk)) continue;
      seen.add(rk);
      if (l.to.type === 'ingress') out.add(sid(l.to.service, l.to.id)); else walk(l.to);
    }
  };
  walk({ type: 'channel', key });
  c.reach.set(k, out);
  return out;
}

function publishersInto(g: GraphIndex, key: string): Publisher[] {
  return linksInto(g, { type: 'channel', key }).filter((l) => l.from.type === 'egress').map((l) => {
    const e = g.egress.get(sid((l.from as any).service, (l.from as any).id))!;
    return { service: e.service, egress: e.id, events: e.events ?? [], possible: candidatesOf(e) };
  });
}

export function node(g: GraphIndex, key: string, types?: number): FlowNode {
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

type Incoming = Map<string, boolean>; // event type -> only possible

function cellFor(c: Ctx, rows: { row: FlowRow; incoming: Incoming }[], consumer: Consumer | null, type: string): Cell {
  if (!consumer) return { status: 'no-consumer', handler: null, uncertain: false, why: 'No harvested service reads this queue.' };
  const relevant = rows.filter((r) => r.incoming.has(type));
  const possible = relevant.every((r) => r.incoming.get(type));
  const cid = sid(consumer.service, consumer.ingress);
  const states = relevant.map((r) => (reach(c, r.row.to.key, type).has(cid) ? stateOf(r.row.filter, type) : 'no' as State));
  const state: State = states.includes('yes') ? 'yes' : states.includes('maybe') ? 'maybe' : 'no';
  const handler = handlerFor(c.g.ingress.get(cid)!, type);
  const flag = possible ? { possible: true } : {};
  if (state === 'no') {
    const f = relevant.find((r) => r.row.filter && stateOf(r.row.filter, type) === 'no')?.row.filter;
    const why = f ? `The filter (${filterLabel(f.events)}) does not let it through.` : relevant.length ? 'A subscription further down does not let it through.' : 'It is not sent here.';
    return { status: 'filtered', handler: null, uncertain: false, why, ...flag };
  }
  const base = { handler, uncertain: state === 'maybe', ...flag };
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
  const ctx: Ctx = { g, sets: new Map(), reach: new Map() };
  const out = mergedBindings(g, key, 'out');
  const layout: ChannelFlow['layout'] = out.size || FANOUT_KINDS.includes(c.kind) ? 'fanout' : 'inbound';
  const eventCount = (k: string) => typesInto(ctx, k).size;
  const asIncoming = (m: Map<string, { possible: boolean }>): Incoming => new Map([...m].map(([t, v]) => [t, v.possible]));
  const mkRow = (from: string, to: string, bs: Binding[]): FlowRow =>
    ({ id: `sub-${slug(from)}-${slug(to)}`, from: node(g, from), to: node(g, to, eventCount(to)), filter: mergeFilter(bs, g), direct: [], consumers: consumersOf(g, to, true) });

  const rows: FlowRow[] = [];
  const incomingOf = new Map<string, Incoming>();
  if (layout === 'fanout') {
    const mine = asIncoming(typesInto(ctx, key));
    for (const { from, to, bs } of out.values()) {
      const row = mkRow(from, to, bs);
      rows.push(row);
      incomingOf.set(row.id, mine);
    }
  } else {
    for (const { from, to, bs } of mergedBindings(g, key, 'in').values()) {
      const row = mkRow(from, to, bs);
      rows.push(row);
      incomingOf.set(row.id, asIncoming(typesInto(ctx, from)));
    }
    const direct = publishersInto(g, key);
    if (direct.length) {
      const row: FlowRow = { id: `sub-direct-${slug(key)}`, from: null, to: node(g, key, eventCount(key)), filter: null, direct, consumers: consumersOf(g, key) };
      rows.push(row);
      const m: Incoming = new Map(direct.flatMap((p) => p.possible.map((t): [string, boolean] => [t, true])));
      for (const p of direct) for (const t of p.events) m.set(t, false);
      incomingOf.set(row.id, m);
    }
  }

  rows.sort((a, b) => a.to.name.localeCompare(b.to.name) || (a.from?.name ?? '').localeCompare(b.from?.name ?? ''));

  // Destinations: one column per (queue, consumer). A queue nobody reads still gets a column.
  const dests: { rows: { row: FlowRow; incoming: Incoming }[]; dest: GridDestination }[] = [];
  if (layout === 'fanout') {
    for (const row of rows) {
      const cs: (Consumer | null)[] = row.consumers.length ? row.consumers : [null];
      for (const consumer of cs) dests.push({ rows: [{ row, incoming: incomingOf.get(row.id)! }], dest: { rowId: row.id, queue: { key: row.to.key, name: row.to.name }, consumer } });
    }
  } else if (rows.length) {
    const own = consumersOf(g, key);
    for (const consumer of own.length ? own : [null]) {
      dests.push({ rows: rows.map((row) => ({ row, incoming: incomingOf.get(row.id)! })), dest: { rowId: rows[0].id, queue: { key, name: c.name ?? key }, consumer } });
    }
  }

  const types = new Map<string, { who: Set<string>; possible: boolean }>();
  const put = (t: string, who: Iterable<string>, possible: boolean) => {
    const cur = types.get(t);
    types.set(t, { who: new Set([...(cur?.who ?? []), ...who]), possible: (cur?.possible ?? true) && possible });
  };
  if (layout === 'fanout') for (const [t, v] of typesInto(ctx, key)) put(t, v.who, v.possible);
  for (const r of rows) for (const [t, possible] of incomingOf.get(r.id)!) {
    const who = layout === 'fanout' ? typesInto(ctx, key).get(t)?.who : r.from ? typesInto(ctx, r.from.key).get(t)?.who : r.direct.filter((p) => p.events.includes(t) || p.possible.includes(t)).map((p) => p.service);
    put(t, who ?? [], possible);
  }
  const grid: DeliveryGrid = {
    destinations: dests.map((d) => d.dest),
    rows: [...types.keys()].sort().map((type) => ({
      type, producers: [...types.get(type)!.who].sort(), ...(types.get(type)!.possible ? { possible: true } : {}),
      cells: dests.map((d) => (d.rows.some((r) => r.incoming.has(type)) ? cellFor(ctx, d.rows, d.dest.consumer, type) : { status: 'filtered' as const, handler: null, uncertain: false, why: 'It is not sent here.' })),
    })),
  };

  const publishers = layout === 'fanout' ? publishersInto(g, key) : [];
  return { layout, rows, consumers: consumersOf(g, key), grid, summary: flowSummary({ name: c.name ?? key, kind: c.kind, layout, rows, grid, publishers, unbound: unboundReasons }) };
}
