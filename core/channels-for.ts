// Which channels (topics, queues, exchanges, buses) and bindings a Components copy of some services must bring so it is
// self-contained, even when another service (usually an infra service) declares them. Pure; the server copies with it and
// the New environment page counts with it.
//
// A channel comes when a picked service declares it, publishes to it (egress), consumes from it (ingress) or binds to it.
// Routing comes with it: the bindings that leave a channel that came, and the queues they lead to, so a publish still has
// somewhere to go (a queue with no consumer yet is a design gap, not a broken call). A binding comes when it connects two
// copied things (its `from` matches a copied channel; its `to` is a copied channel or a picked service's ingress).

import { keyMatches } from './glob.ts';
import type { Binding, Channel, Model } from './types.ts';

export interface ChannelsFor {
  /** Every channel key that ends up in the copy (declared by a picked service or brought along). */
  all: Set<string>;
  /** Channels to bring from services that are not picked. One per key. */
  bring: Channel[];
  /** Bindings to bring from services that are not picked (not those of picked services, which come with them). */
  bindings: Binding[];
}

/** The channel a bind key points at: the key itself, or the part before '/' (an exchange with a routing key). */
export const channelOf = (keys: Set<string>, key?: string): string | null => (key && (keys.has(key) ? key : keys.has(key.split('/')[0]) ? key.split('/')[0] : null)) || null;

export function channelsFor(model: Model, picked: Set<string>): ChannelsFor {
  const keys = new Set(model.channels.map((c) => c.bindKey));
  const all = new Set<string>();
  const ingressKeys = new Set<string>();
  const add = (k: string | null) => { if (k) all.add(k); };
  for (const c of model.channels) if (picked.has(c.service)) all.add(c.bindKey);
  for (const e of model.egress) if (picked.has(e.service)) add(channelOf(keys, e.bindKey));
  for (const i of model.ingress) if (picked.has(i.service)) { add(channelOf(keys, i.bindKey)); ingressKeys.add(i.bindKey); }
  for (const b of model.bindings) if (picked.has(b.service)) { add(channelOf(keys, b.from)); add(channelOf(keys, b.to)); }
  // a binding leaves a channel by its `from`: the channel key, or the key with a routing key / pattern after '/'
  const leaves = (b: Binding, from: Set<string>) => { const ch = channelOf(keys, b.from); return ch ? from.has(ch) : [...from].some((k) => keyMatches(b.from, b.match, k)); };
  // routing out of a channel that came: the queues its bindings lead to
  const first = new Set(all);
  for (const b of model.bindings) if (!picked.has(b.service) && leaves(b, first) && keys.has(b.to)) all.add(b.to);
  const bindings = model.bindings.filter((b) => !picked.has(b.service) && leaves(b, all) && (all.has(b.to) || ingressKeys.has(b.to)));
  const have = new Set(model.channels.filter((c) => picked.has(c.service)).map((c) => c.bindKey));
  const seen = new Set<string>();
  const bring = model.channels.filter((c) => !picked.has(c.service) && all.has(c.bindKey) && !have.has(c.bindKey) && !seen.has(c.bindKey) && !!seen.add(c.bindKey));
  return { all, bring, bindings };
}
