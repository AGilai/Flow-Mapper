// Squeeze (0.20.1), pure: when a lane is wider than the room it has, fold the lifelines that matter least into narrow "fold" columns,
// so the caller and both ends of the current step stay on screen. No DOM; flow-draw-layout.js asks for the plan, flow-draw-fold.js draws it.
// Not the middleware fold (`.fold`, data-mwfold): everything here is `sq-`.

import { isStep } from './flow-steps.js';

export const FOLD_W = 100; // width of a fold column

/** Columns an event touches, as sorted indexes (idx: lifeline -> index). Arrows: both ends (and the topic a publish goes through); a stub or pill: its own lifeline. */
export function eventCols(e, idx) {
  const ends = e.type === 'call' || e.type === 'hop' ? [e.from, e.to, e.via] : e.type === 'return' ? [e.bar?.col, e.to] : e.type === 'unresolved' ? [(e.fromBar ?? e.bar)?.col, e.col]
    : e.type === 'amqpnote' ? [e.col] : e.bar ? [e.bar.col] : [];
  return [...new Set(ends.filter((c) => c != null).map((c) => idx.get(c)).filter((i) => i != null))].sort((a, b) => a - b);
}

/** The folded columns as contiguous runs: [{ from, to, cols }]. Each run is one fold column. */
export function foldGroups(n, folded) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (!folded.has(i)) continue;
    const last = out[out.length - 1];
    if (last && last.to === i - 1) { last.to = i; last.cols.push(i); } else out.push({ from: i, to: i, cols: [i] });
  }
  return out;
}

/** What is drawn left to right: every visible column, and one entry per fold run. [{ cols: [i...], fold: bool }] */
export function displayCols(n, folded) {
  const groups = foldGroups(n, folded), out = [];
  for (let i = 0; i < n; i++) {
    const g = groups.find((x) => x.from === i);
    if (!folded.has(i)) out.push({ cols: [i], fold: false });
    else if (g) out.push({ cols: g.cols, fold: true });
  }
  return out;
}

/** Index of the fold run a column is in, or -1 when it is visible. */
export const groupOf = (groups, col) => groups.findIndex((g) => g.cols.includes(col));

/** The fold run an event sits wholly inside (every column it touches is folded, all in one run), or -1. */
export function foldedInside(cols, groups) {
  if (!cols.length) return -1;
  const g = groupOf(groups, cols[0]);
  return g >= 0 && cols.every((c) => groups[g].cols.includes(c)) ? g : -1;
}

/**
 * planFold({ n, ends, fit, widthOf, caller = 0 }) -> Set of folded column indexes.
 * ends: the columns of the current step. widthOf(foldedSet) -> the lane width with that fold. fit: the room (0: no limit).
 * Nothing folds when the lane fits. Otherwise the columns between the caller and the step's far end that the step does not touch fold first
 * (one fold per run), then, while it still does not fit, the column farthest from the step (the later one on a tie), one at a time.
 * Caller and step ends are never folded. A plan that would be wider than the unfolded lane is dropped.
 */
export function planFold({ n, ends = [], fit, widthOf, caller = 0 }) {
  const none = new Set(), w0 = widthOf(none);
  if (!fit || w0 <= fit || n < 3) return none;
  const at = ends.filter((c) => c >= 0 && c < n), keep = new Set([caller, ...at]), focus = at.length ? at : [caller];
  const folded = new Set();
  for (let c = Math.min(...keep); c <= Math.max(...keep); c++) if (!keep.has(c)) folded.add(c);
  const dist = (c) => Math.min(...focus.map((e) => Math.abs(c - e)));
  const rest = [...Array(n).keys()].filter((c) => !keep.has(c) && !folded.has(c)).sort((a, b) => dist(b) - dist(a) || b - a);
  for (const c of rest) { if (folded.size && widthOf(folded) <= fit) break; folded.add(c); }
  return widthOf(folded) > w0 ? none : folded;
}

/** A stable key for a plan (to tell whether a redraw would change anything). */
export const foldKey = (folded) => [...folded].sort((a, b) => a - b).join(',');

/** The column indexes of an event of `lane` (a step's ends). */
export const colsOfEvent = (lane, e) => eventCols(e, new Map(lane.columns.map((c, k) => [c, k])));
/** What a lane with no walk keeps on screen: the ends of its first step. */
export const firstStepCols = (lane) => { const e = lane.events.find(isStep); return e ? colsOfEvent(lane, e) : []; };
