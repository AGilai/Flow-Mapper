// Who owns a channel (0.50.0, #104): the component whose manifest declares it (`channels[]`), for the flow view's subsystem bands.
// Every channel has one. A non-infra declarer is preferred; failing that the first infra declarer is the owner (a platform component that
// declares a shared topic owns it). With several of one kind: the first in model order. A channel nobody declares has no owner: a gap
// (`channelsWithoutOwner` in link health). Pure.

import { channelOf } from './channels-for.ts';
import type { GraphIndex } from './graph-index.ts';

const memo = new WeakMap<GraphIndex, Map<string, string>>();

/** The owning component of the channel with this bind key, or undefined (nobody declares it). */
export function channelOwner(g: GraphIndex, key: string): string | undefined {
  let m = memo.get(g);
  if (!m) {
    m = new Map();
    const infra = new Map<string, string>();
    for (const c of g.model.channels) {
      if (g.services.get(c.service)?.kind === 'infra') { if (!infra.has(c.bindKey)) infra.set(c.bindKey, c.service); } else if (!m.has(c.bindKey)) m.set(c.bindKey, c.service);
    }
    for (const [k, v] of infra) if (!m.has(k)) m.set(k, v);
    memo.set(g, m);
  }
  return m.get(key);
}

export interface OwnerlessChannel { channel: string; publishers: string[]; consumers: string[] }
const CHANNEL_KEY = /^(sns|sqs|amqp|amqp-queue|eventbridge):/;

/** The channels that components publish to or consume from and no component declares, with who publishes and who consumes. */
export function channelsWithoutOwner(g: GraphIndex): OwnerlessChannel[] {
  const declared = new Set(g.model.channels.map((c) => c.bindKey));
  const out = new Map<string, { publishers: Set<string>; consumers: Set<string> }>();
  const add = (key: string, who: string, side: 'publishers' | 'consumers') => {
    if (!CHANNEL_KEY.test(key) || channelOf(declared, key)) return;
    let x = out.get(key); if (!x) out.set(key, (x = { publishers: new Set(), consumers: new Set() }));
    x[side].add(who);
  };
  for (const e of g.model.egress) add(e.bindKey, e.service, 'publishers');
  for (const i of g.model.ingress) add(i.bindKey, i.service, 'consumers');
  return [...out].map(([channel, x]) => ({ channel, publishers: [...x.publishers].sort(), consumers: [...x.consumers].sort() })).sort((a, b) => (a.channel < b.channel ? -1 : 1));
}
