// The flow of one event type, as the event page draws it: producer service -> topic(s) -> queue ->
// consumer service, one node per service on each side. Outcomes agree with eventReport() in events.ts
// (handled / no-handler / possible); `filtered` rows are kept in the data for agents, the UI skips them.
// Pure. See docs/API.md (event types) and docs/UI-GUIDE.md §2.

import type { GraphIndex } from './graph-index.ts';
import { linksFrom, linksInto, sid } from './graph-index.ts';
import { handlerFor, passes } from './events.ts';
import { refKey } from './resolve.ts';
import { keyMatches } from './glob.ts';
import { codeLink, sourceLink, type SourceLink } from './endpoint-info.ts';
import { mergeFilter, node, candidatesOf, type FlowFilter, type FlowNode } from './channel-flow.ts';
import { eventFlowSummary, type Summary } from './event-flow-summary.ts';
import { egressVia, type EgressVia } from './via.ts';
import type { Ingress, Link, Ref } from './types.ts';

export type EventOutcome = 'handled' | 'no-handler' | 'filtered' | 'possible' | 'no-reader';
/** One ingress of the consumer that the event reaches. `handler` is null when the ingress lists event types and none matches. */
export interface IngressHit {
  id: string; bindKey: string; handler: string | null; ingressHandler: string;
  outcome: 'handled' | 'no-handler';
  /** The ingress accepts any event type (no list, or a `*` entry). */
  any: boolean;
  /** Event types it lists (without `*`); shown when it has no handler for this one. */
  handles: string[];
  /** The handler's code, and where the ingress itself is declared. */
  code: SourceLink | null; at: SourceLink | null;
}
export interface EventRow {
  id: string;
  /** The queue this row delivers to; null when the topic reaches the consumer itself. */
  queue: FlowNode | null;
  /** Topics or buses between the target's topic and the queue (topic to topic chains). */
  via: string[];
  /** The subscription into the queue; null when there is none (a direct send). */
  filter: FlowFilter | null;
  consumer: string | null;
  ingresses: IngressHit[];
  outcome: EventOutcome;
  /** For `possible` rows: what would happen if the producer sends it. */
  ifSent?: 'handled' | 'no-handler';
}
export interface EventTarget { topic: FlowNode | null; direct: boolean; possible: boolean; rows: EventRow[] }
export interface CallSite {
  egress: string; bindKey: string; at: SourceLink | null; possible: boolean;
  /** Channels it sends to first. */
  to: FlowNode[];
  /** For a possible call site: every event type it may send. */
  candidates: string[];
  /** The calling function and where it is, from the harvested call sites (null when none was sent). */
  fn: string | null;
  /** The wrapper chain and the harvested call sites of this egress (see core/via.ts). */
  via: EgressVia;
}
export interface ProducerGroup { producer: string; possible: boolean; callSites: CallSite[]; targets: EventTarget[] }
export interface UnresolvedSend { service: string; egress: string; reason: string; detail: string | null; at: SourceLink | null }
export interface EventFlow {
  type: string;
  groups: ProducerGroup[];
  unresolved: UnresolvedSend[];
  /** Consumers that list this type although no harvested producer reaches them, with their queue and topic. */
  unfed: EventTarget[];
  summary: Summary;
}

const slug = (s: string) => s.replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '');
const isQueue = (g: GraphIndex, key: string) => /queue/.test(g.channels.get(key)?.kind ?? '');

/** A path from an egress: the channels on the way and what ends it (an ingress, or nothing). */
interface Hit { path: string[]; ingress: Ingress | null; filter: FlowFilter | null; filtered: boolean }

/** Every channel path from a ref, with the filters applied; past a filter that blocks the type the hit is marked. */
function walk(g: GraphIndex, type: string, start: Ref): Hit[] {
  const out: Hit[] = [];
  const go = (r: Ref, path: string[], filter: FlowFilter | null, filtered: boolean, seen: Set<string>) => {
    const links = linksFrom(g, r);
    if (!links.length && r.type === 'channel') out.push({ path, ingress: null, filter, filtered });
    for (const l of links) {
      const stops = filtered || !passes(g, l, type);
      const f = l.binding ? filterOf(g, l) : filter;
      if (l.to.type === 'ingress') { out.push({ path, ingress: g.ingress.get(sid(l.to.service, l.to.id))!, filter, filtered: stops }); continue; }
      const k = refKey(l.to);
      if (seen.has(k)) continue;
      go(l.to, l.to.type === 'channel' ? [...path, l.to.key] : path, f, stops, new Set(seen).add(k));
    }
  };
  go(start, [], null, false, new Set());
  return out;
}

function filterOf(g: GraphIndex, l: Link): FlowFilter | null {
  if (!l.binding || l.from.type !== 'channel' || l.to.type !== 'channel') return null;
  const from = l.from.key, to = l.to.key;
  const bs = g.model.bindings.filter((b) => b.to === to && keyMatches(b.from, b.match, from));
  const own = g.bindings.get(sid(l.binding.service, l.binding.id));
  return bs.length ? mergeFilter(bs, g) : own ? mergeFilter([own], g) : null;
}

function hitOf(g: GraphIndex, i: Ingress, type: string): IngressHit {
  const svc = g.services.get(i.service);
  const handler = handlerFor(i, type);
  const fn = handler ? g.fns.get(sid(i.service, handler)) ?? null : null;
  const listed = (i.events ?? []).map((e) => e.type);
  return {
    id: i.id, bindKey: i.bindKey, handler, ingressHandler: i.handler, outcome: handler === null ? 'no-handler' : 'handled',
    any: !listed.length || listed.includes('*'), handles: listed.filter((t) => t !== '*'),
    code: svc ? sourceLink(svc, fn) : null, at: svc ? codeLink(svc, i.source) : null,
  };
}

const rank: Record<EventOutcome, number> = { 'no-handler': 0, possible: 1, handled: 2, 'no-reader': 3, filtered: 4 };
/** Rows reached by a confirmed (not just candidate) producer. */
const confirmed = new WeakSet<EventRow>();

export function eventFlow(g: GraphIndex, type: string): EventFlow {
  const groups = new Map<string, ProducerGroup>();
  const unresolved: UnresolvedSend[] = [];

  for (const e of g.model.egress) {
    const sure = !!e.events?.includes(type);
    const cands = candidatesOf(e);
    if (!sure && !cands.includes(type)) continue;
    const ref: Ref = { type: 'egress', service: e.service, id: e.id };
    const svc = g.services.get(e.service);
    const all = walk(g, type, ref);
    // The key also links the egress straight to the ingress; the route through the channel says more.
    const hits = all.filter((h) => h.path.length || !h.ingress || !all.some((x) => x.path.length && x.ingress === h.ingress));
    const first = linksFrom(g, ref).flatMap((l) => (l.to.type === 'channel' ? [node(g, l.to.key)] : []));
    const grp = groups.get(e.service) ?? { producer: e.service, possible: true, callSites: [], targets: [] };
    groups.set(e.service, grp);
    const via = svc ? egressVia(svc, e) : { via: [], callSites: [] };
    grp.callSites.push({ egress: e.id, bindKey: e.bindKey, at: svc ? codeLink(svc, e.source) : null, possible: !sure, to: first, candidates: sure ? [] : [...(e.events ?? []), ...cands], fn: via.callSites[0]?.function ?? null, via });
    if (sure) grp.possible = false;
    if (!hits.length) {
      const u = e.unresolved?.find((x) => x.what === 'target');
      unresolved.push({ service: e.service, egress: e.id, reason: u?.reason ?? 'no channel matches its bind key', detail: u?.detail ?? e.bindKey, at: svc ? codeLink(svc, e.source) : null });
    }
    for (const h of hits) addHit(g, grp, type, h, sure);
  }

  const out = [...groups.values()].sort((a, b) => +a.possible - +b.possible || a.producer.localeCompare(b.producer));
  for (const grp of out) {
    const viaTopic = (c: CallSite) => +!c.to.some((n) => !/queue/.test(n.kind));
    grp.callSites.sort((a, b) => +a.possible - +b.possible || viaTopic(a) - viaTopic(b) || a.egress.localeCompare(b.egress));
    grp.targets.sort((a, b) => +!!a.topic - +!!b.topic || (a.topic?.name ?? '').localeCompare(b.topic?.name ?? ''));
    for (const t of grp.targets) t.rows.sort((a, b) => rank[a.outcome] - rank[b.outcome] || (a.queue?.name ?? '').localeCompare(b.queue?.name ?? '') || (a.consumer ?? '').localeCompare(b.consumer ?? ''));
  }
  const unfed = unfedTargets(g, type, out);
  return { type, groups: out, unresolved, unfed, summary: eventFlowSummary({ type, groups: out, unresolved, unfed }) };
}

/** Adds the row of one path to the producer's group: one row per (queue, consumer service). */
function addHit(g: GraphIndex, grp: ProducerGroup, type: string, h: Hit, sure: boolean) {
  const last = h.path[h.path.length - 1];
  const queueKey = last && isQueue(g, last) ? last : null;
  const topics = queueKey ? h.path.slice(0, -1) : h.path;
  let t = grp.targets.find((x) => (x.topic?.key ?? null) === (topics[0] ?? null));
  if (!t) { t = { topic: topics[0] ? node(g, topics[0]) : null, direct: !topics[0], possible: true, rows: [] }; grp.targets.push(t); }
  if (sure) t.possible = false;
  if (!queueKey && !h.ingress) return; // a topic nothing subscribes to: the target shows it with no rows
  const consumer = h.ingress?.service ?? null;
  const id = `ev-${slug(grp.producer)}-${slug(queueKey ?? topics[0] ?? 'direct')}-${slug(consumer ?? 'none')}${h.filtered ? '-filtered' : ''}`;
  let row = t.rows.find((r) => r.id === id);
  if (!row) {
    row = { id, queue: queueKey ? node(g, queueKey) : null, via: topics.slice(1), filter: h.filter, consumer, ingresses: [], outcome: 'no-reader' };
    t.rows.push(row);
  }
  if (h.ingress && !row.ingresses.some((x) => x.id === h.ingress!.id)) row.ingresses.push(hitOf(g, h.ingress, type));
  if (sure && !h.filtered) confirmed.add(row);
  const base = h.filtered ? 'filtered' : !row.ingresses.length ? 'no-reader' : row.ingresses.some((x) => x.outcome === 'handled') ? 'handled' : 'no-handler';
  if (base === 'handled' || base === 'no-handler') {
    row.outcome = confirmed.has(row) ? base : 'possible';
    if (row.outcome === 'possible') row.ifSent = base; else delete row.ifSent;
  } else row.outcome = base;
}

/** Consumers that list exactly this type and are reached by no producer here, with the queue and topic that feed them. */
function unfedTargets(g: GraphIndex, type: string, groups: ProducerGroup[]): EventTarget[] {
  const reached = new Set(groups.flatMap((p) => p.targets.flatMap((t) => t.rows.flatMap((r) => (r.outcome === 'filtered' ? [] : r.ingresses.map((x) => sid(r.consumer!, x.id)))))));
  const targets: EventTarget[] = [];
  for (const i of g.model.ingress) {
    if (reached.has(sid(i.service, i.id)) || !i.events?.some((x) => x.type === type)) continue;
    const feeds = linksInto(g, { type: 'ingress', service: i.service, id: i.id }).flatMap((l) => (l.from.type === 'channel' ? [l.from.key] : []));
    for (const queue of feeds.length ? feeds : [null]) {
      // Walk up to the top-most channel feeding the queue.
      const chain: string[] = [];
      let filter: FlowFilter | null = null;
      for (let k = queue; k && chain.length < 8;) {
        const up = linksInto(g, { type: 'channel', key: k }).find((l) => l.from.type === 'channel' && !chain.includes((l.from as { key: string }).key));
        if (!up) break;
        if (k === queue) filter = filterOf(g, up);
        k = (up.from as { key: string }).key;
        chain.unshift(k);
      }
      const topic = chain[0] ?? null;
      let t = targets.find((x) => (x.topic?.key ?? null) === topic);
      if (!t) { t = { topic: topic ? node(g, topic) : null, direct: !topic, possible: false, rows: [] }; targets.push(t); }
      let row = t.rows.find((r) => (r.queue?.key ?? null) === queue && r.consumer === i.service);
      if (!row) { row = { id: `ev-unfed-${slug(queue ?? 'direct')}-${slug(i.service)}`, queue: queue ? node(g, queue) : null, via: chain.slice(1), filter, consumer: i.service, ingresses: [], outcome: 'handled' }; t.rows.push(row); }
      row.ingresses.push(hitOf(g, i, type));
      row.outcome = row.ingresses.some((x) => x.outcome === 'handled') ? 'handled' : 'no-handler';
    }
  }
  return targets;
}
