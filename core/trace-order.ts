// Lifeline order for fan-outs (split from trace.ts).
import type { Message, Participant } from './trace.ts';
import type { GraphIndex } from './graph-index.ts';
import { groupedOrder, type Grouping } from './lifeline-groups.ts';

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

/**
 * Lifelines in delivery order: a topic or queue sits left of whatever it delivers to, so a delivery
 * arrow never points backwards. A channel that is right of its target moves to just before it.
 */
export function deliveryOrder(parts: Participant[], messages: Message[], fanOut = true, grouping?: Grouping): Participant[] {
  const order = [...parts];
  for (let pass = 0, moved = true; moved && pass < 10; pass++) { // a topic may have to move again after its queue did
    moved = false;
    for (const m of messages) {
      if (!m.from.startsWith('ch:') || m.from === m.to) continue;
      const a = order.findIndex((p) => p.id === m.from), b = order.findIndex((p) => p.id === m.to);
      if (a < 0 || b < 0 || a < b) continue;
      const [ch] = order.splice(a, 1);
      order.splice(b, 0, ch);
      moved = true;
    }
  }
  // A channel a service sends to sits right of that sender (and a queue right of the topic that feeds it), so the
  // publish arrow points right: producer -> topic -> queue. Only moves what is backwards; a consumer further left
  // (a loop back to an earlier service) stays where it is.
  for (const m of messages) {
    if (!m.to.startsWith('ch:') || m.from === m.to) continue;
    const a = order.findIndex((p) => p.id === m.from), b = order.findIndex((p) => p.id === m.to);
    if (a < 0 || b < 0 || b > a) continue;
    const [ch] = order.splice(b, 1);
    order.splice(a, 0, ch); // the sender moved one place left when the channel was taken out
  }
  // The pass above can pull a queue right of its consumer (a second topic feeds the same queue and sits further right).
  // A lifeline whose first appearance is as the consumer of a queue (so not an upstream caller) goes right after that queue (#35).
  const first = new Map<string, Message>();
  for (const m of messages) for (const id of [m.from, m.to]) if (!first.has(id)) first.set(id, m);
  for (const m of messages) {
    if (!m.from.startsWith('ch:') || m.to.startsWith('ch:') || first.get(m.to) !== m) continue;
    const a = order.findIndex((p) => p.id === m.from), b = order.findIndex((p) => p.id === m.to);
    if (a < 0 || b < 0 || b > a) continue;
    const [svc] = order.splice(b, 1);
    order.splice(a, 0, svc); // the queue moved one place left when the consumer was taken out, so this is right after it
  }
  return (grouping && groupedOrder(order, messages, grouping)) || (fanOut ? fanOutOrder(order, messages) : order);   // #138: subsystems together where components have a groupPath
}

/** The subsystem order of the env (g.groupOrder), where a trace can use it. */
export const groupingOf = (g: GraphIndex): Grouping => ({ groupOf: (s) => g.services.get(s)?.groupPath ?? '', order: g.groupOrder ?? [] });
