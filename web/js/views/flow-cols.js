// Pure layout math for the lane drawing (flow-draw.js): how wide each gap between lifelines must be so that no arrow
// label is cut, and how a lifeline head's text wraps. No DOM, so tests can import it.

export const LABEL_PX = 7.2; // 12px mono label
export const HEAD_PX = 6.9;  // 12.5px bold name in a lifeline head
export const labelWidth = (t) => Math.ceil(String(t).length * LABEL_PX);

/** The two columns an event's arrow joins, or null when it draws no labelled arrow. */
export function arrowEnds(e) {
  if (!e.label) return null;
  if (e.type === 'call' || e.type === 'hop') return [e.from, e.to];
  if (e.type === 'return') return [e.bar.col, e.to];
  if (e.type === 'unresolved') return [(e.fromBar ?? e.bar).col, e.col];
  return null;
}

/**
 * columnGaps(n, spans, base) -> number[n-1]: the distance between each pair of neighbouring lifelines.
 * spans: [{ a, b, need }] (column indexes, a != b): the arrow from a to b needs `need` px between the two lifelines.
 * Short spans are met first; a deficit is shared evenly by the gaps the span crosses.
 * base: the plain gap, or a function (gap index) -> px (topic and queue lifelines are closer together than services).
 */
export function columnGaps(n, spans, base) {
  const gaps = Array.from({ length: Math.max(0, n - 1) }, (_, i) => (typeof base === 'function' ? base(i) : base));
  const list = spans.map((s) => ({ a: Math.min(s.a, s.b), b: Math.max(s.a, s.b), need: s.need })).filter((s) => s.b > s.a).sort((x, y) => (x.b - x.a) - (y.b - y.a));
  for (const { a, b, need } of list) {
    let have = 0;
    for (let i = a; i < b; i++) have += gaps[i];
    if (have >= need) continue;
    const add = (need - have) / (b - a);
    for (let i = a; i < b; i++) gaps[i] += add;
  }
  return gaps.map(Math.ceil);
}

/** Lifeline centres from the first centre and the gaps. */
export const centres = (first, gaps) => gaps.reduce((xs, g) => (xs.push(xs[xs.length - 1] + g), xs), [first]);

/** Wrap an identifier into lines of at most `max` chars, breaking after - . _ / : and only inside a word when it must. */
export function wrapId(text, max) {
  const parts = String(text).split(/(?<=[-._/:@ ])/);
  const lines = [];
  let cur = '';
  for (let p of parts) {
    if ((cur + p).length <= max) { cur += p; continue; }
    if (cur) { lines.push(cur); cur = ''; }
    while (p.length > max) { const cut = p.length === max + 1 && /[-._/:@]/.test(p[max]) ? max + 1 : max; lines.push(p.slice(0, cut)); p = p.slice(cut); } // never leave a separator alone on a line
    cur = p;
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/** At most `n` lines: what does not fit ends the last line with an ellipsis (the head's title keeps the whole name). */
export function clampLines(lines, max, n = 2) {
  if (lines.length <= n) return lines;
  const rest = lines.slice(n - 1).join('');
  return [...lines.slice(0, n - 1), rest.length > max ? `${rest.slice(0, max - 1)}…` : rest];
}
