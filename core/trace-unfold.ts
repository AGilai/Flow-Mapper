// `unfold` of a trace view (0.44.0, #90), pure. A repeat marker (`↩ seen at step N`) stands for work the trace already drew once; "Expand here" copies
// that first expansion under the marker. The copies are numbered as sub-steps of the marker (7.1, 7.2 ...), so the numbers after it do not shift: every
// other message is renumbered as if the copies were not there, and each copy says what it is in `unfoldOf` (trace-types.ts). A copy starts no deferred
// work (`n`, `of`, `group` and the delivery ordinals are dropped), a nested repeat marker keeps its `repeatOf`.

import type { Message } from './trace-types.ts';
import { renumber } from './trace-renumber.ts';

type Item = { m: Message; i: number };

/** A leaf note the lane does not draw (no `over`, not a return) is no step: leaving it out keeps the sub-step numbers 7.1, 7.2 ... without gaps (flow-lane.js). */
const drawn = (m: Message) => m.kind !== 'leaf' || !!m.over?.length || !!m.returnTo;

/** The items of `kept` that make up the first expansion a marker (a `repeatOf` message at canonical index `at`) points to: what runs under it (deeper than it, in a row). */
function expansionOf(kept: Item[], canonical: Message[], marker: Message): Item[] {
  const head = (marker.repeatOf ?? 0) - 1, h = canonical[head];
  if (!h) return [];
  let end = head + 1;
  while (end < canonical.length && canonical[end].depth > h.depth) end++;
  return kept.filter((x) => x.i > head && x.i < end && drawn(x.m));
}

/** `kept` renumbered (trace-renumber.ts) with the copies of the markers whose key is in `unfold` inserted under them. */
export function renumberUnfolded(kept: Item[], canonical: Message[], unfold: readonly string[]): Message[] {
  const want = new Set(unfold), copies = new Map<number, Item[]>();
  kept.forEach((x, p) => { if (x.m.repeatOf && x.m.key && want.has(x.m.key)) { const c = expansionOf(kept, canonical, x.m); if (c.length) copies.set(p, c); } });
  if (!copies.size) return renumber(kept, canonical);
  const strip = (m: Message): Message => { const { n: _n, ...r } = m; return r; };
  const extra = [...copies.values()].flatMap((c) => c.map((x) => ({ ...x, m: strip(x.m) })));
  const out = renumber([...kept, ...extra], canonical), base = out.slice(0, kept.length), tail = out.slice(kept.length);
  const res: Message[] = [];
  let used = 0;
  base.forEach((m, p) => {
    res.push(m);
    const c = copies.get(p);
    if (!c) return;
    const at = (i: number) => kept.findIndex((x) => x.i === i) + 1, first = m.repeatOf, last = at(c[c.length - 1].i);
    c.forEach((_x, k) => res.push({ ...tail[used + k], unfoldOf: { marker: p + 1, sub: `${p + 1}.${k + 1}`, ...(first ? { first } : {}), ...(last > 0 ? { last } : {}) } }));
    used += c.length;
  });
  return res;
}
