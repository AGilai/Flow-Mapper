// The step walk, pure: the current step (1-based) and the actions that move it, the `step=` URL param and the keyboard map. No DOM.
// Keys: ← → one step, Home / End first and last. [ ] and 1-9 stay the tab keys (flow-tabs-state.js keyAction); Esc is never taken.

/** Clamp a step number into 0..total (0 = no step selected, the state a flow opens in; no steps: 0). */
export const clampStep = (n, total) => (total < 1 ? 0 : Math.min(Math.max(Math.trunc(Number(n)) || 0, 0), total));
/** The step after an action: 'prev' | 'next' | 'first' | 'last'. No wrap: at the ends it stays; 'prev' from step 1 is step 0 (none), 'next' from 0 is step 1. */
export function moveStep(cur, total, action) {
  if (action === 'first') return clampStep(1, total);
  if (action === 'last') return clampStep(total, total);
  return clampStep(cur + (action === 'next' ? 1 : -1), total);
}
/** Which walker button keeps focus when the bar is redrawn at step n of total: the pressed one went disabled (Prev at 0, Next at the end), so focus moves to the other one.
 *  `focused` is 'prev' | 'next' | anything else. Returns 'prev' | 'next' | null (leave focus alone). */
export function focusAfter(focused, n, total) {
  if (focused === 'prev' && n < 1) return total > 0 ? 'next' : null;
  if (focused === 'next' && n >= total) return n >= 1 ? 'prev' : null;
  return null;
}
/** The URL param: `step=3`, or null (no param) when at step 0 (nothing is walked yet). */
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
  if (t?.classList?.contains('seq-scroll') || t?.closest?.('.fi') || t?.closest?.('.flow-bottom, .fp-split')) return null; // a scroller the viewer is scrolling, or the drill-down panel: the arrows are theirs; so are the pane (its tabs use ← →) and its border
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
