// Lifeline order for fan-outs (split from trace.ts).
import type { Message, Participant } from './trace.ts';

/**
 * A fan-out reads left to right (#35): [topic] [q1] [c1] [q2] [c2] ... in delivery order, so each queue -> consumer
 * arrow points right and sits next to its queue. A lifeline cannot appear twice, so one met before the publish stays
 * where it is when moving it would turn an earlier arrow around: it called someone (an upstream caller), or something
 * right of the topic called it. Then its delivery arrow may point left. One only called from the left (the producer
 * checks on every consumer first) moves with its queue. A consumer reached through several queues goes after the first.
 */
export function fanOutOrder(order: Participant[], messages: Message[]): Participant[] {
  const placed = new Set<string>();
  for (const [pi, pub] of messages.entries()) {
    if (!pub.deliveries || !pub.group) continue;
    const before = messages.slice(0, pi);
    const left = (id: string) => order.findIndex((p) => p.id === id) <= order.findIndex((p) => p.id === pub.to);
    const movable = (id: string) => !before.some((m) => m.from !== m.to && (m.from === id || (m.to === id && !left(m.from))));
    const legs: string[] = [];
    for (const [i, m] of messages.entries()) {
      if (m.group !== pub.group || !m.delivery || m.from !== pub.to) continue;
      const out = messages.slice(i + 1).find((x) => x.group === pub.group && x.delivery === m.delivery && x.from === m.to);
      for (const id of [m.to, out?.to]) if (id && id !== pub.to && !placed.has(id) && movable(id)) { placed.add(id); legs.push(id); }
    }
    // data stores that followed a moved consumer stay with it
    const moved = legs.flatMap((id) => {
      const at = order.findIndex((p) => p.id === id);
      if (at < 0) return [];
      let end = at + 1;
      while (order[end]?.kind === 'resource' && !legs.includes(order[end].id)) end++;
      return order.slice(at, end);
    });
    const rest = order.filter((p) => !moved.includes(p));
    rest.splice(rest.findIndex((p) => p.id === pub.to) + 1, 0, ...moved);
    order = rest;
  }
  return order;
}
