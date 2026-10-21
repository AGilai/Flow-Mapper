// Draws a lane (flow-lane.js) as SVG: a sticky header of lifeline cards and a body with activation bars, arrows,
// stubs, the topic and queue lifelines of publish chains and alt frames. No layout rules live here beyond row heights.
//
//   solid arrow, filled head   = call or routing hop     dashed, open head = return
//   red dashed with a cross    = call that matches nothing
//   bar colour / arrow colour  = transport that entered the service / the hop's transport
//   stop bar + number tiles    = a publish chain ends at a queue: the tiles are the async flows that start there (rows of the list below)

import { h, s } from '../dom.js';
import { drawFrames } from './sequence-alt.js';
import { GUTTER, layoutLane } from './flow-draw-layout.js';
import { drawHead, drawLifelines } from './flow-draw-heads.js';
import { foldBands, foldRows } from './flow-draw-fold.js';
import { drawRows } from './flow-draw-rows.js';
import { drawBars } from './flow-draw-bars.js';
import { addCallChips } from './flow-add-call.js';
import { wireEvents } from './flow-draw-events.js';

/**
 * renderLane(lane, handlers) -> { el, body, events, bars, geometry }
 * handlers: onMessage(msg, g, event, trunk), onBar(bar, 'select'?) (double-click, pill: look inside; click: select),
 * onBarMenu(bar, x, y), onParticipant(p, x, y), onNum(jump) (a number tile at a queue), onNumHover(own labels, on), onFan(topic) (fold or unfold a big fan-out).
 * `selected`: bar id drawn highlighted. Returns { el, body, events, bars, geometry, mark(label, on) } (mark: highlight the tiles of a list row).
 * edit: { onAddCall(bar) } in Edit with a draft: a "+ call" under each bar (flow-add-call.js). marks: laneMarks(store) (flow-marks.js): sparks on heads and arrows of a design environment. refs: createRefs(trace, ...) (flow-refs-draw.js): locks on heads, the note and Import chip at an arrow into a reference.
 * squeeze: { keep: [column index] } folds lifelines when the lane is wider than `fit` (flow-squeeze.js); onSqueeze(): a fold column was clicked.
 * geometry: { x: centre x per lifeline (a folded one: its fold's left edge; folded + groups say which), plan(keep) -> the fold set for another step, y: baseline y per row, top: top y per row (plus the bottom), width, height, headHeight, colWidth }
 * for features that draw on the lane (step numbers, squeeze, editing).
 */
export function renderLane(lane, { marks = null, refs = null, edit = null, onMessage, onBar, onBarMenu, onParticipant, onNum, onNumHover, onFan, onMw, onBarTip, onSqueeze, selected = null, sticky = true, fit = 0, squeeze = null } = {}) {
  const c = layoutLane(lane, fit, squeeze, marks, !!edit), { columns, events, bars, width, top, ys, frames, strips } = c, height = c.height
  const head = drawHead({ ...c, marks, refs });
  const drawn = foldRows(drawRows({ ...c, marks, refs }), c);
  const { rects, segs } = drawBars(c, { selected, onBarTip });
  const body = s('svg', { width, height, class: 'seq-body', role: 'group', 'aria-label': `Flow with ${bars.length} calls across ${columns.length} lifelines` },
    s('defs', {}, s('pattern', { id: 'mwh', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('rect', { width: 6, height: 6, fill: 'var(--mw-bg)' }), s('rect', { width: 2.4, height: 6, fill: 'var(--mw)' }))),
    drawFrames(frames, lane.altRows, strips, (r) => top[r], (r) => top[r + 1], width, GUTTER),
    foldBands(c.groups, height), drawLifelines(c), rects, segs, drawn, edit ? addCallChips(c, edit) : null);
  const mark = wireEvents(head, body, c, { onMessage, onBar, onBarMenu, onParticipant, onNum, onNumHover, onFan, onMw, onBarTip, onSqueeze });
  body.__events = events;
  const geometry = { x: c.xs, y: ys, top, width, height, headHeight: c.HEAD, colWidth: c.COLW, folded: c.folded, groups: c.groups, plan: c.plan, sig: c.sig, foldW: c.foldW };
  return { el: h('div.seq', h(sticky ? 'div.seq-sticky' : 'div.seq-head-static', head), body), body, events, bars, geometry, mark };
}
