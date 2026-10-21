// Squeeze drawing (0.20.1): the fold column's head and body band, and the rows that touch a fold. The plan is flow-squeeze.js, the geometry
// flow-draw-layout.js. An arrow into a fold stops at its edge with dots and keeps its label, and the target's name in small mono;
// a row that lies wholly inside a fold (a step between two folded lifelines) shows only its label there, its number tile stays on the fold.

import { s } from '../dom.js';
import { eventCols, foldedInside, groupOf } from './flow-squeeze.js';
import { isStep } from './flow-steps.js';

const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const nameOf = (c) => c?.service ?? c?.label ?? '?';
const textOf = (e) => (e.type === 'store' ? String(e.label) : Array.isArray(e.label) ? e.label.join(' ') : String(e.label ?? ''));

/** The heads of the fold columns, in the head svg. */
export const foldHeads = (groups, boxH, top = 8) => groups.map((g, k) => {
  const list = g.names.join(', '), compact = g.w < 90; // compact (a tight room): "⋯ N" only, the title has the rest
  return s('g', { class: `sq-fold${g.cc ? ' cmp' : ''}`, style: g.cc ? `--cc:${g.cc}` : null, 'data-sqfold': k, transform: `translate(${g.x},${top})`, tabindex: 0, role: 'button', 'aria-label': `${g.cols.length} folded lifelines: ${list}. Click to open` },
    s('rect', { width: g.w, height: boxH, rx: 8 }), s('text', { class: 'fk', x: compact ? 10 : 12, y: 18 }, compact ? `⋯ ${g.cols.length}` : `⋯ ${g.cols.length} folded`), compact ? null : s('text', { class: 'sub', x: 12, y: 33 }, 'click to open'),
    s('title', {}, `${g.cols.length} folded: ${list}\nClick to open`));
});

/** The shaded column behind the rows of each fold. */
export const foldBands = (groups, height) => groups.map((g, k) => s('rect', { class: `sq-band${g.cc ? ' cmp' : ''}`, style: g.cc ? `--cc:${g.cc}` : null, 'data-sqfold': k, x: g.x, y: 0, width: g.w, height }, s('title', {}, `${g.names.join(', ')}\nClick to open`)));

/** Rows touching a fold: one node per event in, one node per event out. */
export function foldRows(nodes, { events, idx, columns, groups, colX, ys }) {
  if (!groups.length) return nodes;
  return nodes.map((node, r) => {
    const e = events[r], y0 = ys[r], inside = foldedInside(eventCols(e, idx), groups);
    if (inside >= 0) return inFold(e, r, y0, groups[inside]);
    const to = e.type === 'unresolved' ? e.col : e.type === 'call' || e.type === 'hop' || e.type === 'store' ? e.to : null, gi = to ? groupOf(groups, idx.get(to)) : -1;
    if (gi < 0) return node;
    const g = groups[gi], left = colX.get(e.type === 'unresolved' ? (e.fromBar ?? e.bar).col : e.from) < g.x, x = left ? g.x : g.x + g.w, name = nameOf(to), room = Math.floor((g.w - 26) / 6.6);
    node.querySelectorAll('.head, .sbar, .sret').forEach((el) => el.remove());
    // a queue at the end of a publish: its stop bar stays at the fold's edge, the number tiles and "no reader" badge would sit on the band's text (open the fold for them)
    const stopped = e.type === 'hop' && e.end;
    node.querySelectorAll('.numtile, .badge').forEach((el) => el.remove());
    node.append(stopped ? null : s('text', { class: 'sq-dots', x, y: y0 + 4, 'text-anchor': left ? 'start' : 'end' }, '⋯'),
      room >= 3 ? s('text', { class: 'sq-to', x: left ? x + (stopped ? 12 : 20) : x - (stopped ? 12 : 20), y: y0 + 4, 'text-anchor': left ? 'start' : 'end' }, clip(name, room), s('title', {}, name)) : null);
    return node;
  });
}

/** A row wholly inside a fold: nothing but a clickable label for a step (returns, bars, pills and stubs vanish with their lifeline). */
function inFold(e, r, y0, g) {
  const step = isStep(e), label = textOf(e);
  return s('g', { class: 'msg sq-in', 'data-e': r, tabindex: step ? 0 : null, role: step ? 'button' : null },
    step ? [s('rect', { class: 'hit', x: g.x, y: y0 - 12, width: g.w, height: 24 }), Math.floor((g.w - 44) / 6.6) >= 3 ? s('text', { class: 'sq-to', x: g.x + 40, y: y0 + 4 }, clip(label, Math.floor((g.w - 44) / 6.6))) : null, s('title', {}, label)] : null);
}
