// The step walk, pure: the current step (1-based) and the actions that move it, the `step=` URL param and the keyboard map. No DOM.
// Keys: ← → one step, Home / End first and last. [ ] and 1-9 stay the tab keys (flow-tabs-state.js keyAction); Esc is never taken.

/** Clamp a step number into 1..total (0 steps: 0). */
export const clampStep = (n, total) => (total < 1 ? 0 : Math.min(Math.max(Math.trunc(Number(n)) || 1, 1), total));
/** The step after an action: 'prev' | 'next' | 'first' | 'last'. No wrap: at the ends it stays. */
export function moveStep(cur, total, action) {
  if (action === 'first') return clampStep(1, total);
  if (action === 'last') return clampStep(total, total);
  return clampStep(cur + (action === 'next' ? 1 : -1), total);
}
/** The URL param: `step=3`, or null (no param) when nothing is walked yet. */
export const encodeStep = (n) => (n >= 1 ? String(n) : null);
/** `step=` of a query (URLSearchParams) -> a positive integer or null. */
export function decodeStep(query) {
  const v = query.get('step');
  return v && /^\d{1,4}$/.test(v) && Number(v) >= 1 ? Number(v) : null;
}
/** A keydown -> 'prev' | 'next' | 'first' | 'last' | null. Never inside a form field or a text box, never with a modifier. */
export function walkAction(e) {
  const t = e.target;
  if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return null;
  if (t?.classList?.contains('seq-scroll') || t?.closest?.('.fi')) return null; // a scroller the viewer is scrolling, or the drill-down panel: the arrows are theirs
  if (e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return null;
  return { ArrowLeft: 'prev', ArrowRight: 'next', Home: 'first', End: 'last' }[e.key] ?? null;
}
/** The text announced to a screen reader when the step changes. */
export const announce = (n, total, label) => (total ? `Step ${n} of ${total}: ${label}` : 'No steps in this flow');

/**
 * scrollLeftFor({ from, to, left, view, pad = 16 }) -> the scrollLeft that shows a step's arrow (lane pixels from..to, from = its source end).
 * Both ends in view when they fit in `view`, moving as little as possible; when they cannot both fit, the source end stays in view (and as much of the arrow as follows it).
 */
export function scrollLeftFor({ from, to, left, view, pad = 16 }) {
  const lo = Math.min(from, to) - pad, hi = Math.max(from, to) + pad;
  if (hi - lo <= view) return lo < left ? Math.max(0, lo) : hi > left + view ? hi - view : left;
  const src = from - pad; // the arrow is wider than the window: start at the source end (or at the left end when it leads the arrow rightwards, else the right end)
  return from <= to ? Math.max(0, src) : Math.max(0, from + pad - view);
}
