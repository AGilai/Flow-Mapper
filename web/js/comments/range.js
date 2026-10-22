// A comment on a range of steps (0.34.0, frame 20): what the walk makes of `steps: { from, to }` (step keys) now, the pill's words, the URL's `steps=4-9`,
// and the one-line "Comment on steps 4-9". Pure, so a node test can load it.

/**
 * rangeLook(steps, nOf) -> { kind: 'range', from, to } | { kind: 'pin', n } | null
 * steps: { from, to } keys; nOf(key) -> the step number now, or null when the flow no longer has that step.
 * Both ends there: the range (numbers in order, whatever a reorder did). One end gone: it stays on the end that is left, as a pin on one step. Both gone: null,
 * the comment reads as a plain one.
 */
export function rangeLook(steps, nOf) {
  if (!steps) return null;
  const a = nOf(steps.from), b = nOf(steps.to);
  if (a == null && b == null) return null;
  if (a == null || b == null) return { kind: 'pin', n: a ?? b };
  const from = Math.min(a, b), to = Math.max(a, b);
  return from === to ? { kind: 'pin', n: from } : { kind: 'range', from, to };
}

export const rangeText = (r) => (r.kind === 'range' ? `steps ${r.from}–${r.to}` : `step ${r.n}`);
/** "Comment on steps 4-9". */
export const rangeAction = (from, to) => `Comment on steps ${from}–${to}`;

/** `steps=4-9` of a flow URL (URLSearchParams) -> { from, to } (numbers, from < to), else null. */
export function stepsParam(query) {
  const m = /^(\d{1,4})-(\d{1,4})$/.exec(query?.get?.('steps') ?? '');
  if (!m) return null;
  const from = Number(m[1]), to = Number(m[2]);
  return from > 0 && to > from ? { from, to } : null;
}
export const stepsValue = (from, to) => `${from}-${to}`;

/** The step numbers of a pointer move in the gutter: `a` and `b` in any order -> { from, to } ordered, or null for one step. */
export const ordered = (a, b) => (a == null || b == null || a === b ? null : { from: Math.min(a, b), to: Math.max(a, b) });

/** Of the steps (`rows`: [{ n, top, bottom }] in lane pixels) the one under `y`, the nearest when `y` is between rows; null when there are none. */
export function stepAtY(rows, y) {
  let best = null, bd = Infinity;
  for (const r of rows) { const d = y < r.top ? r.top - y : y > r.bottom ? y - r.bottom : 0; if (d < bd) { bd = d; best = r.n; } if (d === 0) break; }
  return best;
}
