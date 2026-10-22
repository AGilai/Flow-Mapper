// The words and the run grouping of the step markers (0.38.1, #82 comment 225), pure: `can fail` on a success step (the tag, its tooltip) and
// `only when <guard>` on the steps of the arm that remains (the text, and the runs of consecutive steps that share a guard: one marker on the
// first, a thin gutter line across the run). No DOM, no core imports (the lane modules load in node tests without the core loader).

const at = (s) => (s?.file ? `${s.file}${s.line ? `:${s.line}` : ''}` : '');
const clip = (t, n) => (n && t.length > n ? `${t.slice(0, Math.max(1, n - 1))}…` : t);

/** The tag next to the step label: `can fail: <error>`, or `can fail (2)` for two or more. */
export const canFailTag = (l) => (l.length > 1 ? `can fail (${l.length})` : `can fail: ${l[0].error}`);
/** Its tooltip: when, error and file:line of one entry, or all of them numbered. */
export function canFailTip(l) {
  const one = (c) => [c.when ? `When: ${c.when}` : '', `Error: ${c.error}`, at(c.source)].filter(Boolean);
  return l.length === 1 ? one(l[0]).join('\n') : l.map((c, i) => `${i + 1}. ${one(c).join('\n   ')}`).join('\n');
}
/** `only when <guard>`, clipped to `max` characters (0: whole). */
export const onlyWhenTag = (o, max = 0) => clip(`only when ${o.guard}`, max);
export const onlyWhenTip = (o) => [`Only when: ${o.guard}`, at(o.source)].filter(Boolean).join('\n');

/** Runs of consecutive steps with the same guard. `guards`: the guard of each visible step in order (null: none; a step without one ends a run). Per step: null, or { first, last, start, end } (start / end: the indexes of its run). */
export function guardRuns(guards) {
  const out = guards.map(() => null);
  for (let i = 0; i < guards.length; i++) {
    if (!guards[i]) continue;
    let j = i;
    while (j + 1 < guards.length && guards[j + 1] === guards[i]) j++;
    for (let k = i; k <= j; k++) out[k] = { first: k === i, last: k === j, start: i, end: j };
    i = j;
  }
  return out;
}
