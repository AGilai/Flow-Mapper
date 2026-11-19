// What a lane gets once it is built and before it is drawn (0.28.1): "Group by subsystem" (the components of one subsystem next to each other, the
// bands over them, frame 12c) and the per-flow colour de-clash (two components on one palette slot in one flow are told apart; the stored colours stay).
// Changes `built.columns` only, so Squeeze, the step walk and the drawing all see the one final order; events point at column objects, not at positions.

import { groupColumns } from './flow-bands.js';

/** The group keys of groupColumns' `ranked`, in the environment's order: `top`, `top\n` (components on the parent itself), then `top\n<top/sub>` for each registered second level. */
export const rankedKeys = (subs) => subs.list().flatMap((s) => [s.key, `${s.key}\n`, ...(s.subs ?? []).map((x) => `${s.key}\n${x.key}`)]);

/** #141: where each component is drawn, service -> position among the lifelines (the caller counts as first): buildLane({ drawnAt }) decides "does this arrow cross an open bar" from it, not from call order. */
export const laneRank = (built) => { const at = new Map(); built.columns.forEach((c, i) => { if (c.service && !at.has(c.service)) at.set(c.service, i); }); return at; };

/** #143: a store or channel whose owner has no lifeline in the flow is banded with the component it sits next to: the first one that calls it (the owner's subsystem is not on this diagram). */
function bandWithAccessor(built) {
  const has = new Set(built.columns.filter((c) => c.kind === 'service' && c.service).map((c) => c.service));
  for (const c of built.columns) {
    if (!(c.kind === 'resource' || c.kind === 'channel') || !c.owner || has.has(c.owner)) continue;
    const e = built.events.find((x) => (x.to === c || x.via === c) && x.from?.service);
    if (e) c.bandOwner = e.from.service;
  }
}

/** groupLane(built, subs, on, marks, slotsOf): `subs` = the subsystems store (design/subsystems-store.js); `on`: the "Group by subsystem" check; `marks`: the marks store (a New subsystem gets a spark);
 *  `slotsOf(columns)` -> Map service -> slot (component-colors.js laneSlots, the de-clash). `regroup` false (View > Order > By call order, #138): the lifelines stay in the trace's order, the bands still show; `env`: the environment of the flow; each column carries it (`c.env`), so colours and icons are read from it, not from the page's. */
export function groupLane(built, subs, on, marks, slotsOf = null, env = null, regroup = true) {
  if (subs?.assigned) bandWithAccessor(built); // #143 #145: before the regrouping, which places such a store next to that component
  if (subs?.assigned && regroup) built.columns = groupColumns(built.columns, subs.subOf, subs.subOf2, rankedKeys(subs)); // #138: by subsystem in the environment's order, whatever the bands switch says
  if (on && subs?.assigned) {
    built.group = { subOf: subs.subOf, info: subs.info, subOf2: subs.subOf2, subLabel: subs.subLabel, markOf: (key) => marks?.markOf(`grp:${key}`)?.mark ?? null };
  }
  if (env != null) for (const c of built.columns) c.env = env;
  const slots = slotsOf?.(built.columns);
  if (slots) for (const c of built.columns) if (c.kind === 'service') c.slot = slots.get(c.service) ?? null;
  return built;
}
