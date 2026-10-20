// The compact hub views (topic, queue and event type pages): what to draw around one hub node.
// Pure helpers over a channel flow or an event flow: edge markers, per-queue outcomes, the problem-first
// order with its fold, and the event page's consumers. See docs/UI-GUIDE.md and design/mockups/hub-views.html.

import type { ChannelFlow, Consumer, FlowFilter, FlowRow, GridDestination, Events } from './channel-flow.ts';
import type { EventFlow, EventRow } from './event-flow.ts';
import { filterAllows } from './glob.ts';

/** A mark on an edge: `types` lets N through, `all-but` lets all but N through, `disagree` when declarations differ. */
export interface Marker { kind: 'types' | 'all-but' | 'disagree'; n: number; label: string }

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** null when the filter lets everything through (or there is none). */
export function markerOf(f: FlowFilter | null): Marker | null {
  if (!f) return null;
  if (!f.agree) return { kind: 'disagree', n: f.declarations.length, label: 'disagree' };
  if (f.events === '*') return null;
  const neg = f.events.filter((e) => e.startsWith('!') && e.length > 1).length;
  const pos = f.events.length - neg;
  if (!pos && neg) return { kind: 'all-but', n: neg, label: `all but ${neg}` };
  return { kind: 'types', n: pos, label: plural(pos, 'type') };
}

export const allowsType = (events: Events, type: string) => events === '*' || filterAllows(events, type);

/** What one queue shows: its consumer, the event types by outcome, and whether it is a problem. */
export interface QueueSummary {
  rowId: string;
  queue: { key: string; name: string; kind: string };
  consumers: Consumer[];
  handled: string[];
  noHandler: string[];
  filtered: string[];
  /** Types that only a possible producer sends: not counted above. */
  possible: string[];
  marker: Marker | null;
  disagree: boolean;
  problem: boolean;
}

/** One summary per queue of a topic page (layout fanout), from the delivery grid. */
export function queueSummaries(flow: ChannelFlow): QueueSummary[] {
  const dests = flow.grid.destinations.map((d, i) => ({ d, i }));
  return flow.rows.map((row) => {
    const mine = dests.filter((x) => x.d.rowId === row.id);
    const out: QueueSummary = {
      rowId: row.id, queue: { key: row.to.key, name: row.to.name, kind: row.to.kind }, consumers: row.consumers,
      handled: [], noHandler: [], filtered: [], possible: [], marker: markerOf(row.filter),
      disagree: !!row.filter && !row.filter.agree, problem: false,
    };
    for (const g of flow.grid.rows) {
      const cells = mine.map((x) => g.cells[x.i]);
      if (g.possible || cells.some((c) => c.possible)) { if (cells.some((c) => c.status !== 'filtered')) out.possible.push(g.type); continue; }
      if (cells.some((c) => c.status === 'handled')) out.handled.push(g.type);
      else if (cells.some((c) => c.status === 'no-handler')) out.noHandler.push(g.type);
      else out.filtered.push(g.type);
    }
    out.problem = out.disagree || out.noHandler.length > 0;
    return out;
  });
}

/** Problem queues first, then by name. */
export function orderQueues<T extends { problem: boolean; queue: { name: string } }>(qs: T[]): T[] {
  return [...qs].sort((a, b) => +b.problem - +a.problem || a.queue.name.localeCompare(b.queue.name));
}

/** The first `limit` of an ordered list; problems are never folded away. */
export function foldList<T extends { problem: boolean }>(ordered: T[], limit = 12): { shown: T[]; hidden: T[] } {
  const shown = ordered.filter((q, i) => i < limit || q.problem);
  const hidden = ordered.filter((q) => !shown.includes(q));
  return { shown, hidden };
}

/** Keep the items whose text contains every word of the query (case-insensitive). */
export const matchesQuery = (q: string, ...texts: (string | undefined)[]) => {
  const hay = texts.filter(Boolean).join(' ').toLowerCase();
  return q.toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.includes(w));
};

/** For the info pane: per declaration of a subscription, how many of the event types the topic carries end in each outcome. */
export interface DeclOutcome { service: string; events: Events; handled: string[]; noHandler: string[]; filtered: string[] }
export function declarationOutcomes(flow: ChannelFlow, row: FlowRow): DeclOutcome[] {
  const idx = flow.grid.destinations.map((d, i) => ({ d, i })).filter((x) => x.d.rowId === row.id).map((x) => x.i);
  const types = flow.grid.rows.filter((g) => !g.possible);
  return (row.filter?.declarations ?? []).map((decl) => {
    const o: DeclOutcome = { service: decl.service, events: decl.events, handled: [], noHandler: [], filtered: [] };
    for (const g of types) {
      const cells = idx.map((i) => g.cells[i]);
      if (!allowsType(decl.events, g.type) || cells.every((c) => c.status === 'filtered')) o.filtered.push(g.type);
      else if (cells.some((c) => c.status === 'handled')) o.handled.push(g.type);
      else o.noHandler.push(g.type);
    }
    return o;
  });
}

export interface ConsumerOutcome { consumer: Consumer | null; destination: GridDestination; handled: number; noHandler: number; possible: number }
/** A queue page: the outcome per consumer of this queue. */
export function consumerOutcomes(flow: ChannelFlow): ConsumerOutcome[] {
  return flow.grid.destinations.map((destination, i) => {
    const o: ConsumerOutcome = { consumer: destination.consumer, destination, handled: 0, noHandler: 0, possible: 0 };
    for (const g of flow.grid.rows) {
      const c = g.cells[i];
      if (g.possible || c.possible) { if (c.status !== 'filtered') o.possible++; }
      else if (c.status === 'handled') o.handled++;
      else if (c.status === 'no-handler') o.noHandler++;
    }
    return o;
  });
}

/** An event page: one consumer service with where the event reaches it and what happens. */
export interface HubConsumer {
  service: string;
  /** id of the flow row the summary callouts point at. */
  rowId: string;
  queues: string[];
  direct: number;
  outcome: 'handled' | 'no-handler' | 'possible';
  ifSent: 'handled' | 'no-handler' | null;
  /** Producers that surely send it to this consumer; the rest are only possible. */
  sure: string[];
  maybe: string[];
  problem: boolean;
}
export interface EventHub { producers: { name: string; possible: boolean }[]; consumers: HubConsumer[] }

export function eventHub(flow: EventFlow): EventHub {
  const producers = flow.groups.map((g) => ({ name: g.producer, possible: g.possible }));
  const by = new Map<string, { rows: { r: EventRow; producer: string }[] }>();
  for (const g of flow.groups) for (const t of g.targets) for (const r of t.rows) {
    if (!r.consumer || r.outcome === 'filtered' || r.outcome === 'no-reader') continue;
    if (!by.has(r.consumer)) by.set(r.consumer, { rows: [] });
    by.get(r.consumer)!.rows.push({ r, producer: g.producer });
  }
  const consumers: HubConsumer[] = [...by].map(([service, { rows }]) => {
    const sure = rows.filter((x) => x.r.outcome !== 'possible');
    const outcome = sure.length ? (sure.some((x) => x.r.outcome === 'handled') ? 'handled' : 'no-handler') : 'possible';
    const queues = [...new Set(rows.flatMap((x) => (x.r.queue ? [x.r.queue.name] : [])))];
    return {
      service, rowId: (sure.find((x) => x.r.outcome === "no-handler") ?? sure[0] ?? rows[0]).r.id, queues, direct: new Set(rows.filter((x) => !x.r.queue).map((x) => x.r.id)).size, outcome,
      ifSent: outcome === 'possible' ? rows[0].r.ifSent ?? null : null,
      sure: [...new Set(sure.map((x) => x.producer))], maybe: [...new Set(rows.filter((x) => x.r.outcome === 'possible').map((x) => x.producer))],
      problem: outcome === 'no-handler',
    };
  });
  const rank = { 'no-handler': 0, handled: 1, possible: 2 };
  consumers.sort((a, b) => rank[a.outcome] - rank[b.outcome] || a.service.localeCompare(b.service));
  return { producers, consumers };
}
