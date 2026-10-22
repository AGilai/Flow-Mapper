// How many either/or decisions each entry point's flow reaches, and what that does to its step count (0.38.0, #82 part 3: the Flows list chip "N decisions").
// Only flows that reach a decision are traced (reverse reachability from the steps that host a group), once per graph; a graph without alternatives costs nothing.

import type { GraphIndex } from './graph-index.ts';
import { altIndex } from './alternatives.ts';
import { altGroups, type Alt } from './alt.ts';
import { entryPointsReaching } from './reach.ts';
import { trace } from './trace.ts';
import { viewOf } from './trace-view.ts';

/** `steps`: what the list counts (External, first arm of each decision); `both`: the range per path with Both chosen everywhere; `full`: every internal call too (first arms). */
export interface FlowDecisions { decisions: number; steps: number; both: { min: number; max: number }; full: number }

const chainOf = (a: Alt): Alt[] => (a.parent ? [...chainOf(a.parent), a] : [a]);
const memo = new WeakMap<GraphIndex, Map<string, FlowDecisions>>();

/** The entry points whose flows reach a function that hosts a decision: the only flows worth tracing. */
function candidates(g: GraphIndex): { service: string; ingress: string }[] {
  const ix = altIndex(g);
  const fns = new Map<string, { service: string; fn: string }>();
  for (const grp of ix?.groups.values() ?? []) for (const id of grp.hosts) {
    const c = id.indexOf(':'), h = id.lastIndexOf('#');
    if (c > 0 && h > c) fns.set(id.slice(0, h), { service: id.slice(0, c), fn: id.slice(c + 1, h) });
  }
  for (const f of g.fns.values()) if (f.steps.some((s) => s.altGroup || s.condition || s.groups?.length) && [...altGroups(f.steps, f.id).values()].some((a) => chainOf(a).some((x) => !x.kind || x.kind === 'alt'))) fns.set(`${f.service}:${f.id}`, { service: f.service, fn: f.id }); // 0.38.2: functions with an alt frame
  return fns.size ? entryPointsReaching(g, [...fns.values()], 5000) : [];
}

/** One entry point's numbers, or null when its flow reaches no decision. */
function decisionsOf(g: GraphIndex, e: { service: string; ingress: string }): FlowDecisions | null {
  const t = trace(g, { service: e.service, ingress: e.ingress }, { scope: 'full', maxMessages: 800 });
  if (!t?.decisions?.length) return null;
  const both = viewOf(t, { choose: { '*': 'both' } }), first = viewOf(t, {}), full = viewOf(t, { detail: 'full' });
  return { decisions: both.decisions?.length ?? 0, steps: first.counts?.messages.min ?? 0, both: both.counts?.messages ?? { min: 0, max: 0 }, full: full.counts?.messages.min ?? 0 };
}

/** `${service}:${ingress}` -> its decisions; entry points that reach none are absent. */
export function flowDecisions(g: GraphIndex): Map<string, FlowDecisions> {
  const hit = memo.get(g);
  if (hit) return hit;
  const out = new Map<string, FlowDecisions>();
  memo.set(g, out);
  for (const e of candidates(g)) { const d = decisionsOf(g, e); if (d) out.set(`${e.service}:${e.ingress}`, d); }
  return out;
}

const pending = new WeakMap<GraphIndex, Promise<Map<string, FlowDecisions>>>();
/**
 * The same map, computed in slices: `yieldNow()` runs about every `sliceMs` (the server lets other requests through), so a cold graph with thousands of
 * decision flows (about 50 s at 1,000 services) does not stop the process. Same entries in the same order as `flowDecisions`; concurrent callers share one run.
 */
export function flowDecisionsAsync(g: GraphIndex, yieldNow: () => Promise<void>, sliceMs = 40): Promise<Map<string, FlowDecisions>> {
  const hit = memo.get(g);
  if (hit) return Promise.resolve(hit);
  let p = pending.get(g);
  if (!p) {
    p = (async () => {
      try {
        const out = new Map<string, FlowDecisions>();
        let t0 = Date.now();
        for (const e of candidates(g)) {
          const d = decisionsOf(g, e);
          if (d) out.set(`${e.service}:${e.ingress}`, d);
          if (Date.now() - t0 >= sliceMs) { await yieldNow(); t0 = Date.now(); }
        }
        memo.set(g, out);
        return out;
      } finally { pending.delete(g); }
    })();
    pending.set(g, p);
  }
  return p;
}
