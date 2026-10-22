// The SVG of status marks on a lane: a spark / ring at the top-right of a lifeline head, at the end of an arrow, and the small chips under an
// arrow ("in draft" for a call the draft added; an undecided transport: a small diamond icon, or the text label when Transport hints is on, 0.30.4).

import { sparkSvg } from '../components/status-mark.js';
import { s } from '../dom.js';
import { svgChip, chipW } from './flow-draw-prims.js';
import { onlyWhenTag, onlyWhenTip } from './flow-markers-pure.js';
import { failTag } from './flow-markers-draw.js';

/** The band of a marked step: a soft coloured strip behind its arrow (new = --new, changed = --new-ink), the step's `details.changed` text in its tooltip. */
export const stepBand = (info, x1, x2, y0) => s('g', { class: `stepband ${info.mark === 'changed' ? 'chg' : 'new'}` },
  s('rect', { x: Math.min(x1, x2), y: y0 - 17, width: Math.abs(x2 - x1), height: 25, rx: 3 }), s('title', {}, `${info.mark === 'changed' ? 'Changed' : 'New'} step${info.what ? `: ${info.what}` : ''}`));

/** Head of a lifeline: marks = laneMarks(store) | null, c = the column, w = the head width. */
export const headMarkSvg = (marks, c, w) => {
  const r = marks?.head(c);
  return r ? sparkSvg(w - 2, 3, r.info.mark, 12) : null; // on the corner, clear of the name
};

export { chipW };
export const TBD_TEXT = 'transport not decided', ICON_W = 15; // the icon is as big as the new / changed mark (11px) in a 15px hit box

/** The chips under an arrow: [text, variant][] ("in draft" for a call the draft added; "transport not decided": variant 'tbd' is the text chip, 'tbd-i' the icon, by `th`). */
export const markChips = (marks, msg, th = true, ow = false) => [marks?.arrow(msg)?.inDraft ? ['in draft', 'draft'] : null, msg?.transport === 'undecided' ? [TBD_TEXT, th ? 'tbd' : 'tbd-i'] : null, ow && msg?.onlyWhen ? [onlyWhenTag(msg.onlyWhen, 34), 'ow', onlyWhenTip(msg.onlyWhen)] : null].filter(Boolean); // 0.38.1: "only when <guard>" on the first step of a run
const widthOf = ([t, v]) => (v === 'tbd-i' ? ICON_W : chipW(t));

/** The "transport not decided" icon: a hollow diamond (neutral, not a spark), its words in the tooltip. */
export const tbdIcon = (cx, y0) => {
  const cy = y0 + 14.5, r = 5.5;
  return s('g', { class: 'chip-b tbd-i', role: 'img', 'aria-label': TBD_TEXT }, s('rect', { class: 'hit', x: cx - ICON_W / 2, y: cy - ICON_W / 2, width: ICON_W, height: ICON_W }),
    s('path', { d: `M${cx} ${cy - r}L${cx + r} ${cy}L${cx} ${cy + r}L${cx - r} ${cy}z` }), s('title', {}, TBD_TEXT));
};

/** Do two or more chips not fit beside the step tile on an arrow of this length? They are then stacked, one per line (UI-GUIDE section 10), never over the return label. */
export const chipsStack = (chips, span) => chips.length > 1 && chips.reduce((n, c) => n + widthOf(c) + 4, -4) + 56 > span;

/** Under an arrow, at its tail (after the step tile): the chips side by side, so the return label in the middle stays clear; stacked when `stack`. */
export function arrowMarkSvg(marks, msg, x1, x2, y0, stack = false, th = true, mk = {}) { // mk: { ow: the step starts a run of one guard, label: the arrow's label }
  const r = marks?.arrow(msg), dir = Math.sign(x2 - x1) || 1, chips = markChips(marks, msg, th, mk.ow).map((c) => (c[1] === 'ow' ? [onlyWhenTag(msg.onlyWhen, Math.max(12, Math.floor((Math.abs(x2 - x1) - 80 - chipsBefore(c, marks, msg, th)) / 6.1))), 'ow', c[2]] : c));
  const band = r?.step ? stepBand(r.info, x1, x2, y0) : null; // 0.32.2 (#75): a marked step also gets a coloured band along its arrow
  const total = chips.reduce((n, c) => n + widthOf(c) + 4, -4);
  let x = dir > 0 ? x1 + 28 : x1 - 28 - (stack ? 0 : total), k = 0;
  return [band, failTag(msg, x1, x2, y0, mk.label), r ? sparkSvg(x2 - dir * 16, y0 + 11, r.info.mark, 11) : null,
    ...chips.map((c) => {
      const w = widthOf(c), cx = stack ? (dir > 0 ? x + w / 2 : x1 - 28 - w / 2) : x + w / 2, y = stack ? y0 + 19 * k++ : y0;
      if (!stack) x += w + 4;
      return c[1] === 'tbd-i' ? tbdIcon(cx, y) : svgChip(c[0], cx, y, c[1], c[2]);
    })];
}
const chipsBefore = (c, marks, msg, th) => markChips(marks, msg, th).reduce((n, x) => n + widthOf(x) + 4, 0); // the chips that sit before the "only when" chip on the same line
