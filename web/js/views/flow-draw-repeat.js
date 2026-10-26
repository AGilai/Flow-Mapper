// Repeat markers and unfolded copies of the Simple view (0.44.0, #90, frame 24): a repeat is drawn like a delivery repeat, a thin dotted arrow with
// `↩ seen at step N` as an accent link (a click jumps to step N; the Info pane has "Expand here"); the steps an `unfold` copies under it sit in a dashed
// bracket "unfolded copy of steps 3-7", numbered 7.1, 7.2 ...

import { s } from '../dom.js';
import { arrow } from './flow-draw-prims.js';

const seen = / ↩ seen at step \d+/;

/** The row of a repeat marker (an event with `repeat: N`, no bar): a thin arrow to the callee, the link above it, the call under it. */
export function repeatRow(e, g, x1, x2, y0, mc, hit) {
  const mid = (x1 + x2) / 2, sub = String(e.label).replace(seen, '');
  return g('rep', arrow(x1, x2, y0, { color: mc }), s('text', { class: 'rplab', x: mid, y: y0 - 6, 'text-anchor': 'middle', 'data-jump': e.repeat }, `↩ seen at step ${e.repeat}`),
    s('text', { class: 'rpsub', x: mid, y: y0 + 13, 'text-anchor': 'middle' }, sub), hit(x1, x2), s('title', {}, `${e.msg.label}\nThe same call already happened at step ${e.repeat}. Click to go there.`));
}

/** The dashed bracket round each run of unfolded copies, with its label and the sub-step numbers. */
export function drawUnfolds(events, top, width, gutter = 0) {
  const runs = [];
  events.forEach((e, r) => {
    const u = e.msg?.unfoldOf;
    if (!u) return;
    const last = runs[runs.length - 1];
    if (last && last.marker === u.marker && last.end === r - 1) last.end = r; else runs.push({ marker: u.marker, first: u.first, lastStep: u.last, start: r, end: r });
  });
  return runs.map((run) => {
    const y1 = top[run.start] + 2, y2 = top[run.end + 1] - 2, x = gutter + 6, label = `unfolded copy of ${run.first && run.lastStep ? `steps ${run.first}–${run.lastStep}` : 'the first expansion'}`;
    return s('g', { class: 'unfold', 'data-unfold': run.marker }, s('rect', { class: 'unfold-box', x, y: y1, width: Math.max(40, width - x - 8), height: Math.max(10, y2 - y1), rx: 8 }),
      s('text', { class: 'unfold-lab', x: x + 40, y: y1 + 12 }, label),
      ...events.flatMap((e, r) => (e.msg?.unfoldOf?.marker === run.marker && r >= run.start && r <= run.end ? [s('text', { class: 'unfold-no', x: x + 14, y: (top[r] + top[r + 1]) / 2 + 4 }, e.msg.unfoldOf.sub)] : [])));
  });
}
