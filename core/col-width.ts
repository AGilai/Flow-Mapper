// Table column widths in a document (Unreleased): the pure part. A first-row cell may carry `data-w`, a whole percent 5 to 95; a drag moves the border
// between two neighbouring columns, so their sum stays the same and the table never grows past 100%.

export const MIN_W = 5, MAX_W = 95;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** `data-w` -> the percent, or null when it is not a whole number 5..95. */
export function parseWidth(v: string | null | undefined): number | null {
  const t = (v ?? '').trim();
  if (!/^\d{1,2}$/.test(t)) return null;
  const n = Number(t);
  return n >= MIN_W && n <= MAX_W ? n : null;
}

/** The two widths (percent) around a border moved by `delta` percent: the left one grows, the right shrinks; each stays at least MIN_W and the sum is kept. */
export function resizePair(a: number, b: number, delta: number): [number, number] {
  const total = a + b;
  if (total < 2 * MIN_W) return [a, b];
  const na = clamp(Math.round(a + delta), MIN_W, Math.min(MAX_W, total - MIN_W));
  return [na, total - na];
}

/** A pixel width as a whole percent of the table's width (clamped to 5..95). */
export const toPercent = (px: number, tablePx: number) => (tablePx > 0 ? clamp(Math.round((px / tablePx) * 100), MIN_W, MAX_W) : MIN_W);
