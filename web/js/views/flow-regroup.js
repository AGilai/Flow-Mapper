// #88 follow-up: "Group the N calls into one arrow again" from the Info pane of a call of an expanded store run.

import { runContext } from '../../core/db-run.js';
import { dbContext } from './flow-panel-calls.js';

const arrowEl = (body, m) => { const f = [...body.querySelectorAll('.seq-body')].map((b) => ({ b, k: b.__events?.findIndex((e) => e.msg === m) })).find((x) => x.k >= 0); return f ? f.b.querySelector(`[data-e="${f.k}"]`) : null; };

// Simple has no separate arrows (0.44.0): a merged row's pane lists the calls without "Show the N calls as separate arrows"; "Open in External" is the way on.
/**
 * createRegroup({ scen, walk, body, host, trace(), openMessage(m, g, tr) }) -> { contextOf(m) }. contextOf: the pane context of a store call that belongs to a run (null otherwise).
 * Its `group()` folds the run (the tab's DB toggle), goes to the merged step, selects the merged arrow and keeps the pane open on it.
 */
export function createRegroup({ scen, walk, body, host, trace, openMessage }) {
  function regroup(runKey) {
    scen.toggleDb(runKey);
    const merged = trace().messages.find((x) => x.key === runKey && x.dbGroup), g = merged && arrowEl(body, merged);
    if (!g) { host.panel.close(); return; }
    const n = walk.steps().find((x) => x.event.msg === merged)?.n;
    if (n) walk.go(n);
    openMessage(merged, g, trace());
  }
  return { contextOf(m, g) { if (g.closest('.flow-idx')) return null; if (m.dbGroup) { const c = dbContext(m, { walk, host, onDb: scen.toggleDb }); return scen.isSimple?.() ? { ...c, expand: null } : c; } const run = m.kind === 'resource' && scen.runOf ? scen.runOf(m.key) : null; return run ? runContext(m, run, { steps: () => walk.steps(), regroup }) : null; } };
}
