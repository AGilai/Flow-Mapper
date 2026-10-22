// The scenario of every tab of the Flows page (0.38.0, #82): one state object per tab key { detail, open, chosen, rawCh, dbOpen }, kept while the page lives
// (a closed tab that is reopened with Alt+Shift+T has its choices back; a cross-env tab `env|key` has its own). Only the ACTIVE tab writes to the URL
// (`ch=`, `detail=full`, `open=`, like `zoom=` and `step=`); the link's own values apply to the tab that is active when the page opens.
// A `ch=` that arrives before the tab's data does is kept as text (`rawCh`) and written back unchanged until the decisions are known.

import { readQuery, scenarioQuery } from './flow-scenario-pure.js';

/** createScenarios(query, activeKey, stored) -> { of(key) -> state, initial(key) -> { detail, open }, query(key) -> { ch, detail, open } }; stored(): the viewer's remembered detail. */
export function createScenarios(query, activeKey, stored) {
  const map = new Map(), url = readQuery(query);
  const of = (key) => {
    if (!map.has(key)) {
      const mine = key === activeKey;
      map.set(key, { detail: (mine && url.detail) || stored(), open: new Set(mine ? url.open : []), chosen: new Map(), rawCh: mine ? query.get('ch') : null, decisions: [], dbOpen: new Set(), resolved: false });
    }
    return map.get(key);
  };
  return {
    of,
    initial: (key) => { const s = of(key); return { detail: s.detail, open: [...s.open] }; },
    query: (key) => { const s = key ? (map.get(key) ?? (key === activeKey ? of(key) : null)) : null; // the active tab's own state exists from the start: its `ch=` is kept until its decisions are known (it was erased while the tab loaded)
      return !s ? { ch: null, detail: null, open: null } : { ...scenarioQuery(s.decisions, s), ...(s.resolved ? {} : { ch: s.rawCh || null }) }; },
  };
}
