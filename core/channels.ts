// Topics, queues, exchanges and event buses: who publishes into each one, what feeds it, where its
// subscriptions (rules) send which event types, who consumes it, and the event types passing through.

import type { GraphIndex } from './graph-index.ts';
import { linksFrom, linksInto, sid } from './graph-index.ts';
import { eventReport } from './events.ts';
import { keyMatches } from './glob.ts';

export interface ChannelSummary { key: string; name: string; kind: string; publishers: number; consumers: number; subscriptions: number; problems: number }

export function channelView(g: GraphIndex, key: string) {
  const c = g.channels.get(key);
  if (!c) return null;
  const ev = eventReport(g);
  const ref = { type: 'channel' as const, key };
  const conflicts = ev.conflicts.filter((x) => x.from === key);
  const into = linksInto(g, ref);
  return {
    key, name: c.name ?? key, kind: c.kind, details: c.details ?? {},
    declaredBy: [...new Set(g.model.channels.filter((x) => x.bindKey === key).map((x) => x.service))],
    publishers: into.filter((l) => l.from.type === 'egress').map((l) => {
      const e = g.egress.get(sid((l.from as any).service, (l.from as any).id))!;
      return { service: e.service, egress: e.id, events: e.events ?? [] };
    }),
    feeds: into.filter((l) => l.from.type === 'channel').map((l) => (l.from as any).key as string),
    subscriptions: g.model.bindings.filter((b) => keyMatches(b.from, b.match, key)).map((b) => ({
      id: b.id, service: b.service, to: b.to, toChannel: g.channels.has(b.to), events: b.events ?? '*' as const, conflict: conflicts.some((x) => x.to === b.to),
    })),
    consumers: linksFrom(g, ref).filter((l) => l.to.type === 'ingress').map((l) => {
      const i = g.ingress.get(sid((l.to as any).service, (l.to as any).id))!;
      return { service: i.service, ingress: i.id, handler: i.handler, events: (i.events ?? []).map((e) => e.type) };
    }),
    events: eventsThrough(g, key),
    problems: [
      ...g.resolution.unbound.filter((u) => u.channel.bindKey === key).map((u) => u.reason),
      ...conflicts.map((x) => `subscription to ${x.to} is reported differently by ${x.declarations.map((d) => d.service).join(' and ')}`),
    ],
  };
}

/** Event types that pass through a channel, with their producers and the consumers they reach. */
function eventsThrough(g: GraphIndex, key: string) {
  const out = new Map<string, { type: string; producers: string[]; consumers: string[]; unhandled: number }>();
  for (const d of eventReport(g).deliveries) {
    const published = g.egress.get(sid(d.producer.service, d.producer.egress))?.bindKey === key;
    if (!published && !d.via.includes(key)) continue;
    const e = out.get(d.event) ?? { type: d.event, producers: [], consumers: [], unhandled: 0 };
    out.set(d.event, e);
    if (!e.producers.includes(d.producer.service)) e.producers.push(d.producer.service);
    if (!e.consumers.includes(d.consumer.service)) e.consumers.push(d.consumer.service);
    if (d.handler === null) e.unhandled++;
  }
  return [...out.values()].sort((a, b) => a.type.localeCompare(b.type));
}

export function channelSummaries(g: GraphIndex): ChannelSummary[] {
  const unbound = new Set(g.resolution.unbound.map((u) => u.channel.bindKey));
  const conflicts = eventReport(g).conflicts;
  return [...g.channels.values()].map((c) => {
    const ref = { type: 'channel' as const, key: c.bindKey };
    return {
      key: c.bindKey, name: c.name ?? c.bindKey, kind: c.kind,
      publishers: linksInto(g, ref).filter((l) => l.from.type === 'egress').length,
      consumers: linksFrom(g, ref).filter((l) => l.to.type === 'ingress').length,
      subscriptions: g.model.bindings.filter((b) => keyMatches(b.from, b.match, c.bindKey)).length,
      problems: (unbound.has(c.bindKey) ? 1 : 0) + conflicts.filter((x) => x.from === c.bindKey).length,
    };
  }).sort((a, b) => a.key.localeCompare(b.key));
}
