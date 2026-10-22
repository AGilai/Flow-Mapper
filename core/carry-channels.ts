// The channels each service brings into a Components copy, for every service at once.
// Same answer as `[...channelsFor(model, new Set([s])).all]` for each service `s` (same keys, same order), but the routing
// step reads only the bindings that can leave one of that service's channels instead of scanning every binding per service.

import { keyMatches } from './glob.ts';
import { channelOf } from './channels-for.ts';
import type { Model } from './types.ts';

export function carryChannelKeys(model: Model): Map<string, string[]> {
  const keys = new Set(model.channels.map((c) => c.bindKey));
  const mine = new Map<string, { channels: string[]; egress: string[]; ingress: string[]; bindings: [string, string][] }>();
  const of = (s: string) => { let x = mine.get(s); if (!x) mine.set(s, (x = { channels: [], egress: [], ingress: [], bindings: [] })); return x; };
  for (const c of model.channels) of(c.service).channels.push(c.bindKey);
  for (const e of model.egress) of(e.service).egress.push(e.bindKey);
  for (const i of model.ingress) of(i.service).ingress.push(i.bindKey);
  for (const b of model.bindings) of(b.service).bindings.push([b.from, b.to]);
  // bindings that leave a channel by key (indexed by that channel) and those that leave by a pattern (checked against the service's channels)
  const leaving = new Map<string, number[]>(), byPattern: number[] = [];
  model.bindings.forEach((b, i) => {
    const ch = channelOf(keys, b.from);
    if (!ch) { byPattern.push(i); return; }
    const l = leaving.get(ch);
    if (l) l.push(i); else leaving.set(ch, [i]);
  });
  const out = new Map<string, string[]>();
  for (const s of model.services) {
    const m = mine.get(s.name) ?? { channels: [], egress: [], ingress: [], bindings: [] };
    const all = new Set<string>(m.channels);
    const add = (k: string | null) => { if (k) all.add(k); };
    for (const k of m.egress) add(channelOf(keys, k));
    for (const k of m.ingress) add(channelOf(keys, k));
    for (const [from, to] of m.bindings) { add(channelOf(keys, from)); add(channelOf(keys, to)); }
    const first = [...all];
    const hit = new Set<number>();
    for (const k of first) for (const i of leaving.get(k) ?? []) hit.add(i);
    for (const i of byPattern) { const b = model.bindings[i]; if (first.some((k) => keyMatches(b.from, b.match, k))) hit.add(i); }
    for (const i of [...hit].sort((a, b) => a - b)) {
      const b = model.bindings[i];
      if (b.service !== s.name && keys.has(b.to)) all.add(b.to);
    }
    out.set(s.name, [...all]);
  }
  return out;
}
