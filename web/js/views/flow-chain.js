// Pure helpers for "a publish is a routing chain that stops at the queue" (0.17.0): service -> topic / bus / exchange -> each
// subscribed queue. Built from the messages of a publish's region (flow-scan.js); no DOM, so tests can import it.
//
//  chainOf        publish -> legs (one arrow each) with the deliveries that end on them, and nothing of the consumer's own work
//  planChains     all chains of a lane -> lifeline order (topic, then its queues) and the fold of big fan-outs ("+N queues")
//  foldFanout     which queues of one topic are drawn, which fold
//  filterMarker   the text on a topic -> queue arrow: "1 type", "all but 1", the rule of an event bus, the routing key of an exchange
//  badgesAt       the number tiles at a queue: one per consumer row, or a range

import { isChannel } from './flow-scan.js';

export const FOLD_LIMIT = 6;
const unhandled = (d) => !!(d.unhandled || d.broken || d.gap || !d.target?.ingress);

/** "sns:payment-events" -> "sns"; "amqp-queue:q" -> "amqp". */
export const chType = (key) => String(key).split(':')[0].replace('amqp-queue', 'amqp');
/** "sns:payment-events" -> "payment-events". */
export const chName = (key) => String(key).replace(/^[^:]+:/, '');

/** The event type on a hop's arrow, as a REST arrow shows its path. An untyped publish names the types its subscription lets through; AMQP names its routing key. */
export function hopLabel(m) {
  if (m.event) return m.event;
  if (m.matched?.length) return m.matched.join(', ');
  const rk = m.label.match(/\bamqp:[^/\s]+\/(\S+)/)?.[1];
  if (rk) return rk;
  return m.label.split(' · ')[1]?.replace(/ · possible$/, '') ?? 'publish';
}

/** An AMQP publish names `amqp:<exchange>/<routing key>`; the trace goes straight to the bound queue, so the exchange is read from the binding. */
export function exchangeOf(pub) {
  const from = pub.filter?.from;
  if (pub.transport !== 'amqp' || !pub.to.startsWith('ch:amqp-queue:') || !from?.startsWith('amqp:')) return null;
  const ex = from.slice(5).split('/')[0];
  return ex ? `amqp:${ex}` : null;
}

const split = (events) => ({ pos: events.filter((e) => !e.startsWith('!')), neg: events.filter((e) => e.startsWith('!') && e.length > 1).map((e) => e.slice(1)) });

/**
 * The marker on a hop that goes through a subscription: { kind: 'types'|'all-but'|'rule'|'key', label, full } or null (no filter, or one that lets everything through).
 * types: a funnel and "1 type" / "3 types"; all-but: a crossed funnel and "all but 1"; rule (event bus): the rule's name; key (exchange): the routing key.
 */
export function filterMarker(filter, transport) {
  if (!filter) return null;
  const { events, id, service, from } = filter;
  const who = `${id} (${service})`;
  const list = events && events !== '*' ? split(events) : null;
  const what = !list ? 'every event type' : !list.pos.length ? `every type except ${list.neg.join(', ')}` : `${list.pos.join(', ')}${list.neg.length ? ` except ${list.neg.join(', ')}` : ' only'}`;
  if (transport === 'eventbridge' || String(from).startsWith('eventbridge:')) return { kind: 'rule', label: 'rule ' + id.replace(/^(rule|sub)\./, ''), full: `Rule ${who} lets through ${what}` };
  if (transport === 'amqp' || String(from).startsWith('amqp:')) {
    const key = String(from).replace(/^amqp:[^/]*\/?/, '');
    return key ? { kind: 'key', label: key, full: `Binding ${who}: routing key ${key}` } : null;
  }
  if (!list) return null;
  if (!list.pos.length) return list.neg.length ? { kind: 'all-but', label: `all but ${list.neg.length}`, full: `Subscription ${who} lets through ${what}` } : null;
  return { kind: 'types', label: `${list.pos.length} ${list.pos.length === 1 ? 'type' : 'types'}`, full: `Subscription ${who} lets through ${what}` };
}

/**
 * chainOf(msgs, p) -> { pub, root, legs }   (p: a publish from scanLane)
 * legs: [{ msg, from, to, delivers: [deliver msgs that start on `to`], filter, via }] in trace order; the first leg is the publish itself
 * (service -> its channel). Only hops out of channels at the publish's depth are read: what the consumers do after their delivery is not part of it.
 * An AMQP publish gets its exchange as an extra first channel (service -> exchange -> queue).
 */
export function chainOf(msgs, p) {
  const pub = msgs[p.i], ex = exchangeOf(pub);
  const legs = ex
    ? [{ msg: pub, from: null, to: ex, delivers: [], filter: null, first: true }, { msg: pub, from: ex, to: pub.to.slice(3), delivers: [], filter: pub.filter ?? null, first: false }]
    : [{ msg: pub, from: null, to: pub.to.slice(3), delivers: [], filter: pub.filter ?? null, first: true }];
  for (let j = p.i + 1; j <= p.end; j++) {
    const x = msgs[j];
    if (x.depth !== pub.depth || !isChannel(x.from)) continue;
    const from = x.from.slice(3);
    if (x.kind === 'egress' && isChannel(x.to)) { legs.push({ msg: x, from, to: x.to.slice(3), delivers: [], filter: x.filter ?? null, first: false }); continue; }
    if (x.kind !== 'deliver') continue;
    const leg = [...legs].reverse().find((l) => l.to === from);
    if (leg) leg.delivers.push(x);
  }
  return { pub, root: legs[0].to, legs };
}

export const isQueueKey = (key) => /^(sqs|amqp-queue):/.test(String(key));

/** A queue is healthy when something reads it and every delivery reaches a handler. */
export const isHealthy = (leg) => leg.delivers.length > 0 && leg.delivers.every((d) => !unhandled(d) && !d.possible);

/**
 * foldFanout(queues, { limit, open }) -> { shown: key[], folded: key[] }
 * queues: [{ key, healthy }] in lifeline order. Up to `limit` stay; beyond that the healthy ones fold (those with a problem always stay).
 * A fold of one queue is not worth a lifeline: it stays.
 */
export function foldFanout(queues, { limit = FOLD_LIMIT, open = false } = {}) {
  if (open || queues.length <= limit) return { shown: queues.map((q) => q.key), folded: [] };
  const room = Math.max(0, limit - queues.filter((q) => !q.healthy).length);
  let kept = 0;
  const keep = new Set(queues.filter((q) => !q.healthy || kept++ < room).map((q) => q.key));
  const folded = queues.filter((q) => !keep.has(q.key)).map((q) => q.key);
  if (folded.length < 2) return { shown: queues.map((q) => q.key), folded: [] };
  return { shown: queues.filter((q) => keep.has(q.key)).map((q) => q.key), folded };
}

/**
 * planChains(chains, { fanOpen }) -> { order, colOf, folds }
 * order: [{ key, role: 'topic'|'queue'|'fold', group, queues? }] lifelines right of the services, grouped per topic (the topic, then its queues in first-seen order).
 * A queue several publishes reach keeps one lifeline (in the group that met it first). colOf(key) maps a queue to its fold lifeline when it is folded.
 * folds: Map(topic -> { id, topic, queues (the ones that fold), open }) for every topic with a fan-out big enough to fold, open or not.
 * fanOpen: Set of topic keys (or true) the user has unfolded.
 */
export function planChains(chains, { fanOpen = false } = {}) {
  const groups = [], at = new Map(); // at: key -> group
  const health = new Map();
  for (const c of chains) {
    const g = at.get(c.root) ?? (groups.push({ root: c.root, keys: [] }), at.set(c.root, groups[groups.length - 1]), groups[groups.length - 1]);
    for (const l of c.legs) {
      if (l.from == null || at.has(l.to)) continue;
      at.set(l.to, g); g.keys.push(l.to);
    }
    for (const l of c.legs) if (l.from != null) health.set(l.to, (health.get(l.to) ?? true) && isHealthy(l));
  }
  const order = [], folds = new Map(), fold = new Map();
  groups.forEach((g, n) => {
    order.push({ key: g.root, role: isQueueKey(g.root) ? 'queue' : 'topic', group: n });
    const open = fanOpen === true || (fanOpen instanceof Set && fanOpen.has(g.root));
    const items = g.keys.map((key) => ({ key, healthy: health.get(key) !== false })), closed = foldFanout(items);
    const { shown, folded } = open ? { shown: g.keys, folded: [] } : closed;
    shown.forEach((key) => order.push({ key, role: 'queue', group: n }));
    if (closed.folded.length) folds.set(g.root, { id: `fold:${g.root}`, topic: g.root, queues: closed.folded, open });
    if (folded.length) {
      order.push({ key: `fold:${g.root}`, role: 'fold', group: n, queues: folded, topic: g.root });
      folded.forEach((k) => fold.set(k, `fold:${g.root}`));
    }
  });
  return { order, colOf: (key) => fold.get(key) ?? key, folds };
}

const parts = (l) => String(l).split('.').map(Number);
const cmpLabel = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] ?? -1) !== (y[i] ?? -1)) return (x[i] ?? -1) - (y[i] ?? -1); return 0; };

/** "3–5" for consecutive row numbers, "3.1–3.4" inside a card, "1, 4, 6" for a few that are not. */
export function rangeLabel(labels) {
  const ls = [...new Set(labels)].sort(cmpLabel);
  if (ls.length <= 1) return ls[0] ?? '';
  const pre = (l) => String(l).split('.').slice(0, -1).join('.'), last = (l) => parts(l).at(-1);
  const flat = ls.every((l) => pre(l) === pre(ls[0])) && ls.every((l, i) => !i || last(l) === last(ls[i - 1]) + 1);
  if (flat) return `${ls[0]}–${ls.at(-1)}`;
  return ls.length <= 3 ? ls.join(', ') : `${ls[0]} … ${ls.at(-1)}`;
}

/**
 * The number tiles at a queue (the end of a chain): items [{ label (own row), shows (what the tile reads: the row it repeats for a "seen" delivery), seen }] ->
 * tiles [{ text, jump (row to open), seen, title, n, own (the rows it stands for) }]. One tile per consumer row up to two, then a range. Repeats are muted tiles of their own.
 */
export function badgesAt(items) {
  const make = (list, seen) => {
    const by = [...new Map(list.map((i) => [i.shows, i])).values()].sort((a, b) => cmpLabel(a.shows, b.shows));
    const own = (rows) => list.filter((i) => rows.some((r) => r.shows === i.shows)).map((i) => i.label);
    if (!by.length) return [];
    if (by.length <= 2) return by.map((i) => ({ text: i.shows, jump: i.shows, seen, n: 1, own: own([i]), title: seen ? `Seen before: the flow ${i.shows} already shows this delivery` : `Async flow ${i.shows}` }));
    return [{ text: rangeLabel(by.map((i) => i.shows)), jump: by[0].shows, seen, n: by.length, own: own(by), title: `${by.length} ${seen ? 'repeated ' : ''}async flows` }];
  };
  return [...make(items.filter((i) => !i.seen), false), ...make(items.filter((i) => i.seen), true)];
}
