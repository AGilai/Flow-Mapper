// The layout of comment brackets in the diagram's left gutter (0.34.0, frame 20e rules), pure so a node test can load it:
//  - at most `maxCols` columns (3; 2 at 760 px); a further range is "hidden" and becomes a "+n" chip,
//  - columns are assigned by start step, the longer range first, and a column is used again once the range in it has ended,
//  - bubbles sit mid-range; two that would touch slide the later one down 17 px inside its range.

export const COL_W = 12, GUTTER = 60, GUTTER_NARROW = 44, BUBBLE_H = 15, SLIDE = 17;

/** ranges: [{ id, from, to, ... }] in step numbers (from < to). -> { placed: [{ ...range, col }], hidden: [range] } */
export function assignColumns(ranges, maxCols = 3) {
  const sorted = [...ranges].sort((a, b) => a.from - b.from || b.to - a.to || String(a.id).localeCompare(String(b.id)));
  const ends = [], placed = [], hidden = [];
  for (const r of sorted) {
    let c = ends.findIndex((e) => e < r.from);
    if (c < 0 && ends.length < maxCols) c = ends.length;
    if (c < 0) { hidden.push(r); continue; }
    ends[c] = r.to;
    placed.push({ ...r, col: c });
  }
  return { placed, hidden };
}

/** Ranges grouped by identical (from, to): one bracket with the number of comments (`n`) and their ids. */
export function groupRanges(comments) {
  const by = new Map();
  for (const c of comments) {
    const k = `${c.from}-${c.to}`, g = by.get(k) ?? by.set(k, { id: k, from: c.from, to: c.to, n: 0, ids: [], text: c.text ?? '' }).get(k);
    g.n++; g.ids.push(c.id);
  }
  return [...by.values()];
}

/** Bubble tops for brackets already placed (`y0`, `y1` in px, in column order of their start): mid-range, sliding down while one would touch an earlier bubble. */
export function bubbleTops(items) {
  const out = new Map(), taken = [];
  for (const it of [...items].sort((a, b) => a.y0 - b.y0 || a.col - b.col)) {
    let y = Math.round((it.y0 + it.y1) / 2 - BUBBLE_H / 2);
    const max = Math.max(it.y0, it.y1 - BUBBLE_H);
    while (y < max && taken.some((t) => Math.abs(t - y) < SLIDE)) y += SLIDE;
    y = Math.min(y, max);
    taken.push(y); out.set(it.id, y);
  }
  return out;
}
