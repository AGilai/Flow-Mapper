// What a lane gets once it is built and before it is drawn (0.28.1): "Group by subsystem" (the components of one subsystem next to each other, the
// bands over them, frame 12c) and the per-flow colour de-clash (two components on one palette slot in one flow are told apart; the stored colours stay).
// Changes `built.columns` only, so Squeeze, the step walk and the drawing all see the one final order; events point at column objects, not at positions.

import { groupColumns } from './flow-bands.js';

/** groupLane(built, subs, on, marks, slotsOf): `subs` = the subsystems store (design/subsystems-store.js); `on`: the "Group by subsystem" check; `marks`: the marks store (a New subsystem gets a spark);
 *  `slotsOf(columns)` -> Map service -> slot (component-colors.js laneSlots, the de-clash). */
export function groupLane(built, subs, on, marks, slotsOf = null) {
  if (on && subs?.assigned) {
    built.columns = groupColumns(built.columns, subs.subOf);
    built.group = { subOf: subs.subOf, info: subs.info, markOf: (key) => marks?.markOf(`grp:${key}`)?.mark ?? null };
  }
  const slots = slotsOf?.(built.columns);
  if (slots) for (const c of built.columns) if (c.kind === 'service') c.slot = slots.get(c.service) ?? null;
  return built;
}
