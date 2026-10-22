// Indexes over an event report: the deliveries between one egress and one ingress, and the conflicting subscription declarations.

import type { GraphIndex } from './graph-index.ts';
import { eventReport, type Delivery, type EventReport } from './events.ts';
import type { Binding } from './types.ts';

const ck = (service: string, id: string) => `${service}\u0000${id}`;
const pairs = new WeakMap<GraphIndex, Map<string, Delivery[]>>();

/** The deliveries from one egress to one ingress, in report order (the same as filtering `eventReport(g).deliveries`). Indexed once per graph. */
export function deliveriesBetween(g: GraphIndex, producer: { service: string; egress: string }, consumer: { service: string; ingress: string }): Delivery[] {
  let m = pairs.get(g);
  if (!m) {
    pairs.set(g, (m = new Map()));
    for (const d of eventReport(g).deliveries) {
      const k = `${ck(d.producer.service, d.producer.egress)}\u0001${ck(d.consumer.service, d.consumer.ingress)}`;
      let l = m.get(k);
      if (!l) m.set(k, (l = []));
      l.push(d);
    }
  }
  return m.get(`${ck(producer.service, producer.egress)}\u0001${ck(consumer.service, consumer.ingress)}`) ?? [];
}


export function subscriptionConflicts(bindings: Binding[]): EventReport['conflicts'] {
  const norm = (b: Binding) => (!b.events || b.events === '*' ? '*' : [...b.events].sort());
  const groups = new Map<string, Binding[]>();
  for (const b of bindings) {
    const k = `${b.from}\u0000${b.to}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(b);
  }
  return [...groups.values()]
    .filter((bs) => new Set(bs.map((b) => JSON.stringify(norm(b)))).size > 1)
    .map((bs) => ({ from: bs[0].from, to: bs[0].to, declarations: bs.map((b) => ({ service: b.service, id: b.id, events: norm(b) })) }));
}

