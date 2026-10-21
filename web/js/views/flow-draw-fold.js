// Squeeze drawing (0.20.1): the fold column's head and body band, and the rows that touch a fold. The plan is flow-squeeze.js, the geometry
// flow-draw-layout.js. An arrow into a fold stops at its edge with dots and keeps its label, and the target's name in small mono;
// a row that lies wholly inside a fold (a step between two folded lifelines) shows only its label there, its number tile stays on the fold.

import { s } from '../dom.js';
import { FOLD_W, eventCols, foldedInside, groupOf } from './flow-squeeze.js';
import { isStep } from './flow-steps.js';

const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
const nameOf = (c) => c?.service ?? c?.label ?? '?';
const textOf = (e) => (e.type === 'store' ? `${e.verb} ${e.name}` : Array.isArray(e.label) ? e.label.join(' ') : String(e.label ?? ''));

/** The heads of the fold columns, in the head svg. */
export const foldHeads = (groups, boxH) => groups.map((g, k) => {
  const list = g.names.join(', ');
  return s('g', { class: 'sq-fold', 'data-sqfold': k, transform: `translate(${g.x},8)`, tabindex: 0, role: 'button', 'aria-label': `${g.cols.length} folded lifelines: ${list}. Click to open` },
    s('rect', { width: FOLD_W, height: boxH, rx: 8 }), s('text', { class: 'fk', x: 12, y: 18 }, `⋯ ${g.cols.length} folded`), s('text', { class: 'sub', x: 12, y: 33 }, 'click to open'),
    s('title', {}, `${g.cols.length} folded: ${list}\nClick to open`));
});

/** The shaded column behind the rows of each fold. */
export const foldBands = (groups, height) => groups.map((g, k) => s('rect', { class: 'sq-band', 'data-sqfold': k, x: g.x, y: 0, width: FOLD_W, height }, s('title', {}, `${g.names.join(', ')}\nClick to open`)));

/** Rows touching a fold: one node per event in, one node per event out. */
export function foldRows(nodes, { events, idx, columns, groups, colX, ys }) {
  if (!groups.length) return nodes;
  return nodes.map((node, r) => {
    const e = events[r], y0 = ys[r], inside = foldedInside(eventCols(e, idx), groups);
    if (inside >= 0) return inFold(e, r, y0, groups[inside]);
    const to = e.type === 'unresolved' ? e.col : e.type === 'call' || e.type === 'hop' ? e.to : null, gi = to ? groupOf(groups, idx.get(to)) : -1;
    if (gi < 0) return node;
    const g = groups[gi], left = colX.get(e.type === 'unresolved' ? (e.fromBar ?? e.bar).col : e.from) < g.x, x = left ? g.x : g.x + FOLD_W, name = nameOf(to);
    node.querySelectorAll('.head').forEach((el) => el.remove());
    node.append(s('text', { class: 'sq-dots', x, y: y0 + 4, 'text-anchor': left ? 'start' : 'end' }, '⋯'),
      s('text', { class: 'sq-to', x: left ? x + 20 : x - 20, y: y0 + 4, 'text-anchor': left ? 'start' : 'end' }, clip(name, 11), s('title', {}, name)));
    return node;
  });
}

/** A row wholly inside a fold: nothing but a clickable label for a step (returns, bars, pills and stubs vanish with their lifeline). */
function inFold(e, r, y0, g) {
  const step = isStep(e), label = textOf(e);
  return s('g', { class: 'msg sq-in', 'data-e': r, tabindex: step ? 0 : null, role: step ? 'button' : null },
    step ? [s('rect', { class: 'hit', x: g.x, y: y0 - 12, width: FOLD_W, height: 24 }), s('text', { class: 'sq-to', x: g.x + 40, y: y0 + 4 }, clip(label, 8)), s('title', {}, label)] : null);
}
