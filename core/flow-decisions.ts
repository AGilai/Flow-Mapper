// How many either/or decisions each entry point's flow reaches, and what that does to its step count (0.38.0, #82 part 3: the Flows list chip "N decisions").
// Only flows that reach a decision are traced (reverse reachability from the steps that host a group), once per graph; a graph without alternatives costs nothing.

import type { GraphIndex } from './graph-index.ts';
import { altIndex } from './alternatives.ts';
import { entryPointsReaching } from './reach.ts';
import { trace } from './trace.ts';
import { viewOf } from './trace-view.ts';

/** `steps`: what the list counts (External, first arm of each decision); `both`: the range per path with Both chosen everywhere; `full`: every internal call too (first arms). */
export interface FlowDecisions { decisions: number; steps: number; both: { min: number; max: number }; full: number }

const memo = new WeakMap<GraphIndex, Map<string, FlowDecisions>>();

/** `${service}:${ingress}` -> its decisions; entry points that reach none are absent. */
export function flowDecisions(g: GraphIndex): Map<string, FlowDecisions> {
  const hit = memo.get(g);
  if (hit) return hit;
  const out = new Map<string, FlowDecisions>();
  memo.set(g, out);
  const ix = altIndex(g);
  if (!ix) return out;
  const fns = new Map<string, { service: string; fn: string }>();
  for (const grp of ix.groups.values()) for (const id of grp.hosts) {
    const c = id.indexOf(':'), h = id.lastIndexOf('#');
    if (c > 0 && h > c) fns.set(id.slice(0, h), { service: id.slice(0, c), fn: id.slice(c + 1, h) });
  }
  for (const e of entryPointsReaching(g, [...fns.values()], 5000)) {
    const t = trace(g, { service: e.service, ingress: e.ingress }, { scope: 'full', maxMessages: 800 });
    if (!t?.decisions?.length) continue;
    const both = viewOf(t, { choose: { '*': 'both' } }), first = viewOf(t, {}), full = viewOf(t, { detail: 'full' });
    out.set(`${e.service}:${e.ingress}`, { decisions: both.decisions?.length ?? 0, steps: first.counts?.messages.min ?? 0, both: both.counts?.messages ?? { min: 0, max: 0 }, full: full.counts?.messages.min ?? 0 });
  }
  return out;
}
