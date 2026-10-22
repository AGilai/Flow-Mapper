// A note on the lifelines (0.32.2, #74): a leaf step that names `over` draws as a box. Over one component it sits under that lifeline;
// over several it spans from the leftmost to the rightmost of them (a folded lifeline: out to the edge of its fold column).
// The geometry is pure (noteBox); noteSvg draws it. Row type `note` (flow-lane.js): { msg, bar, cols: [column], text }.

import { s } from '../dom.js';

export const NOTE_PAD = 14, NOTE_MIN = 96, NOTE_MAX = 260, CH = 6.2;

/** { x, w } of a note: `cols` the columns it is over, `colX` their x (a folded column: the fold's left edge), `idx` column -> index, `groups` the fold columns ({ cols: [index], x, w }). */
export function noteBox(cols, textLen, { colX, idx, groups = [] }) {
  const ends = cols.map((c) => {
    const g = groups.find((f) => f.cols.includes(idx.get(c)));
    return g ? [g.x, g.x + g.w] : [colX.get(c) - NOTE_PAD, colX.get(c) + NOTE_PAD];
  });
  const l = Math.min(...ends.map((e) => e[0])), r = Math.max(...ends.map((e) => e[1]));
  if (new Set(cols).size > 1 && r - l > NOTE_MIN) return { x: l, w: r - l };
  const w = Math.min(NOTE_MAX, Math.max(NOTE_MIN, Math.ceil(textLen * CH) + 20)), mid = (l + r) / 2;
  return { x: mid - w / 2, w };
}

const clip = (t, n) => (t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);

/** The note of an event row at baseline `y0`. */
export function noteSvg(e, y0, geo) {
  const { x, w } = noteBox(e.cols, e.text.length, geo), n = Math.max(3, Math.floor((w - 16) / CH));
  return s('g', { class: `lnote${e.cols.length > 1 ? ' span' : ''}`, 'data-over': e.cols.length },
    s('rect', { x, y: y0 - 14, width: w, height: 24, rx: 4 }), s('text', { x: x + 8, y: y0 + 2 }, clip(e.text, n)), s('title', {}, e.text));
}
