// The SVG of status marks on a lane: a spark / ring at the top-right of a lifeline head, at the end of an arrow, and the small chips under an
// arrow ("in draft" for a call the draft added, "transport not decided" for an undecided transport).

import { sparkSvg } from '../components/status-mark.js';
import { svgChip } from './flow-draw-prims.js';

/** Head of a lifeline: marks = laneMarks(store) | null, c = the column, w = the head width. */
export const headMarkSvg = (marks, c, w) => {
  const r = marks?.head(c);
  return r ? sparkSvg(w - 2, 3, r.info.mark, 12) : null; // on the corner, clear of the name
};

export const chipW = (t) => Math.ceil(t.length * 6.1) + 16;

/** The chips under an arrow: [text, variant][] ("in draft" for a call the draft added, "transport not decided"). */
export const markChips = (marks, msg) => [marks?.arrow(msg)?.inDraft ? ['in draft', 'draft'] : null, msg?.transport === 'undecided' ? ['transport not decided', 'tbd'] : null].filter(Boolean);

/** Do two or more chips not fit beside the step tile on an arrow of this length? They are then stacked, one per line (UI-GUIDE section 10), never over the return label. */
export const chipsStack = (chips, span) => chips.length > 1 && chips.reduce((n, [t]) => n + chipW(t) + 4, -4) + 56 > span;

/** Under an arrow, at its tail (after the step tile): the chips side by side, so the return label in the middle stays clear; stacked when `stack`. */
export function arrowMarkSvg(marks, msg, x1, x2, y0, stack = false) {
  const r = marks?.arrow(msg), dir = Math.sign(x2 - x1) || 1, chips = markChips(marks, msg);
  const total = chips.reduce((n, [t]) => n + chipW(t) + 4, -4);
  let x = dir > 0 ? x1 + 28 : x1 - 28 - (stack ? 0 : total), k = 0;
  return [r ? sparkSvg(x2 - dir * 16, y0 + 11, r.info.mark, 11) : null,
    ...chips.map(([t, v]) => {
      const w = chipW(t), el = stack ? svgChip(t, dir > 0 ? x + w / 2 : x1 - 28 - w / 2, y0 + 19 * k++, v) : svgChip(t, x + w / 2, y0, v);
      if (!stack) x += w + 4;
      return el;
    })];
}
