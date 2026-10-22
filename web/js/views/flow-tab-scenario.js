// What a flow tab needs for its scenario (0.38.0): the controller (flow-scenario.js) over the trace the tab was loaded with, the header controls
// (flow-scenario-ui.js) and the hooks the diagram calls (a dropdown on a divider row, "⊕ internal" under a head, a DB group row). The tab keeps
// drawing from `trace`; `onView(view)` hands it the new one.

import { createScenario } from './flow-scenario.js';
import { createScenarioUi } from './flow-scenario-ui.js';
import { stepsText } from './flow-scenario-pure.js';

/** createTabScenario({ data, host, key, visible(key), onView(view) }) -> { view, scen, ui, hooks, info(), range() }. host: { scen: createScenarios(...), baseFor, onScenario(key) }. */
export function createTabScenario({ data, host, key, visible, onView }) {
  const st = host.scen.of(key);
  const srcUrl = (at) => scen.view().code?.[`step:${at}`]?.url ?? null;
  const scen = createScenario({ st, base: data.trace, req: data.req, baseFor: host.baseFor, visible, onChange: (v) => { ui.update(v); onView(v); host.onScenario?.(key); } });
  const ui = createScenarioUi({ scen, st, srcUrl });
  const view = scen.view();
  ui.update(view);
  const lazy = () => !scen.isFull() && scen.view().scope !== 'intra';
  return {
    view, scen, ui,
    hooks: { onChoose: scen.choose, onInternal: scen.toggleOpen, onDb: scen.toggleDb, dbOpen: () => st.dbOpen, srcUrl, icalls: () => scen.isFull() || st.open.size > 0,
      internal: () => (lazy() ? { state: (svc) => (scen.loading.has(svc) ? 'loading' : st.open.has(svc) ? 'open' : 'closed') } : null) },
    /** The header's "6 steps" / "6–7 steps": exact, or a range only while "Both" is chosen somewhere. */
    counts: (trace) => (trace.counts?.messages ? stepsText(trace.counts) : ''),
    /** The step bar's note: "6–7 steps per path" while a range stands. */
    range: () => { const c = scen.view().counts?.messages; return c && c.min !== c.max ? stepsText(scen.view().counts, true) : ''; },
  };
}
