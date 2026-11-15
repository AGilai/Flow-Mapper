// The Flows page's width levels and the tab row's plan (frame 28), the pure part. The level comes from the width of the main column (the diagram's column,
// without the Flows strip and the right pane): L0 >= 1500, L1 1100-1499, L2 760-1099, L3 < 760. No DOM.

export const L1 = 1500, L2 = 1100, L3 = 760;
/** 0..3 for a width in px (an unmeasured 0 counts as the widest: nothing is folded before the page has a width). */
export const levelOf = (w) => (!(w > 0) || w >= L1 ? 0 : w >= L2 ? 1 : w >= L3 ? 2 : 3);

/** The active tab shows its entry id only at L0 and with up to 4 tabs open. */
export const activeShowsId = (level, count) => level === 0 && count <= 4;

/** A short id tail: `in.get.products.id.reviews` -> `.reviews`; an id without a dot stays as it is (cut at 18 characters). */
export function shortTail(id) {
  const s = String(id ?? ''), i = s.lastIndexOf('.'), t = i >= 0 && i < s.length - 1 ? s.slice(i) : s;
  return t.length > 18 ? `${t.slice(0, 17)}…` : t;
}

/** The titles that more than one tab has: those tabs keep a short id tail even when inactive. */
export function sharedTitles(titles) {
  const n = new Map();
  titles.forEach((t) => n.set(t, (n.get(t) ?? 0) + 1));
  return new Set([...n].filter(([, c]) => c > 1).map(([t]) => t));
}

/** Which tabs stay in the row: the most that fit in `avail` px (the first ones, in order), the active one always, swapped in for the last visible when it is not among them.
 *  widths: each tab's width; gap: the space between tabs. -> ascending indexes. At least one tab stays, however narrow. */
export function planTabs({ widths, avail, active = -1, gap = 2 }) {
  const n = widths.length;
  if (!n) return [];
  const total = (idx) => idx.reduce((s, i) => s + widths[i], 0) + gap * (idx.length - 1);
  for (let k = n; k >= 1; k--) {
    const idx = Array.from({ length: k }, (_, i) => i);
    if (active >= k) idx[k - 1] = active;
    if (k === 1 || total(idx) <= avail) return idx.sort((a, b) => a - b);
  }
  return [0];
}

/** The text of the "more" button: "N more" (L0 to L2), "N" at L3. */
export const moreLabel = (hidden, level) => (level === 3 ? String(hidden) : `${hidden} more`);
