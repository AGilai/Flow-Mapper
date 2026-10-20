// Middleware on the activation bar (#31): the segments that sit on top of a service's bar, one per middleware function,
// or one "middleware (N)" segment when the chain is longer than MW_FOLD and not expanded. Pure layout rules, no DOM.

export const MW_FOLD = 3;

/**
 * mwSegments(chain, expanded) -> [{ label, fn, indexes, folded, n }]
 * chain: [{ fn, name }] in run order. One segment per middleware; a chain longer than MW_FOLD folds into one
 * segment that covers every index, unless `expanded`.
 */
export function mwSegments(chain, expanded = false, limit = MW_FOLD) {
  if (!chain?.length) return [];
  if (chain.length > limit && !expanded) return [{ label: `middleware (${chain.length})`, fn: null, indexes: chain.map((_, i) => i), folded: true, n: chain.length }];
  return chain.map((c, i) => ({ label: c.name || c.fn, fn: c.fn, indexes: [i], folded: false, n: 1, ...(i === 0 && chain.length > limit ? { collapse: true } : {}) }));
}

/** Position of the segment that holds middleware `index`, or -1. */
export const segmentOf = (segs, index) => segs.findIndex((s) => s.indexes.includes(index));

/** Can the chain be folded or unfolded (is it longer than the fold limit)? */
export const isLongChain = (chain, limit = MW_FOLD) => (chain?.length ?? 0) > limit;

/**
 * mwSpans(labelRows, endRow) -> [{ from, to }]: the rows of each segment. A segment starts at its own label row and
 * runs to the row before the next label; the last one runs to `endRow` (the last row before the handler's part).
 */
export function mwSpans(labelRows, endRow) {
  return labelRows.map((from, i) => ({ from, to: i + 1 < labelRows.length ? labelRows[i + 1] - 1 : Math.max(from, endRow) }));
}

/** Text of a segment's label: its name, with the internal calls folded into it. */
export const mwLabel = (seg, internal = 0) => `${seg.collapse ? '▾ ' : ''}${seg.label}${internal ? ` · ${internal} internal` : ''}${seg.folded ? ' ▸' : ''}`;
