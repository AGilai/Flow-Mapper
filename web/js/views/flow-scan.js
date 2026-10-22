// Pure helpers that cut a trace's message list into the sync lane and the async work it starts.
// A publish (egress into a channel) starts an async region: the hops out of channels right after it (its deliveries) and the
// work of each consumer. The caller keeps going after the publish (#73: an async callee's work runs after the caller's own
// steps), so the region is NOT contiguous: a consumer's messages are found by their tag, not by depth. A delivery carries
// `n` (its message number), every message of its work `of` = the `n` of the innermost delivery it runs under (core/trace.ts).
// No DOM, so tests can import it.

export const isChannel = (id) => typeof id === 'string' && id.startsWith('ch:');
export const isPublish = (m) => m.kind === 'egress' && isChannel(m.to) && !isChannel(m.from);

/** The consumer flow a delivery opens: { service, ingress } or null (not a delivery, broken, unhandled, no target). */
export function asyncFlowOf(m) {
  if (m.kind !== 'deliver' || m.broken || m.unhandled || m.gap || !m.target?.service || !m.target?.ingress) return null;
  return { service: m.target.service, ingress: m.target.ingress };
}

/** Index of the hop messages right after publish `i`: out of a channel, at the publish's depth or deeper (hops of one publish are contiguous). */
const hopsEnd = (msgs, i, hi) => {
  let e = i;
  for (let j = i + 1; j <= hi; j++) { const x = msgs[j]; if (isChannel(x.from) && x.from !== x.to && x.depth >= msgs[i].depth && x.of === msgs[i].of) e = j; else break; }
  return e;
};

/**
 * Split msgs[lo..hi] into lane messages (indexes) and publishes, each with its region and the deliveries it makes.
 * Returns { lane: number[], publishes: [{ i, hopEnd, end, delivers: number[], members: number[] }] }.
 * `hopEnd`: the last hop out of a channel; `members`: every index of the region (publish, hops, the consumers' work, in order), which skips
 * the lane; `end`: the last of them.
 */
export function scanLane(msgs, lo = 0, hi = msgs.length - 1) {
  const lane = [], publishes = [], owned = new Set();
  for (let i = lo; i <= hi; i++) {
    const m = msgs[i];
    if (owned.has(i)) continue;
    if (i > lo && isChannel(m.from) && m.from !== m.to) continue; // a stray hop out of a channel (should sit inside a region)
    lane.push(i);
    if (!isPublish(m)) continue;
    const hopEnd = hopsEnd(msgs, i, hi), members = [], delivers = [], starts = new Set();
    for (let j = i; j <= hopEnd; j++) {
      members.push(j);
      if (j > i && msgs[j].kind === 'deliver' && msgs[j].depth === m.depth) { delivers.push(j); if (msgs[j].n != null) starts.add(msgs[j].n); }
    }
    for (let j = hopEnd + 1; j <= hi; j++) { // the consumers' work, wherever it sits after the hops
      const x = msgs[j];
      if (x.of == null || !starts.has(x.of)) continue;
      members.push(j);
      if (x.n != null) starts.add(x.n);
    }
    members.forEach((j) => owned.add(j));
    publishes.push({ i, hopEnd, end: members[members.length - 1], delivers, members });
  }
  return { lane, publishes };
}

/**
 * The messages of each delivery's own flow: { start, end } (inclusive indexes of what the consumer does, the
 * delivery itself not included) per delivery index; start > end when nothing follows. A consumer's work is
 * contiguous (it runs whole, nested work included), and found by its tag: `of` is the delivery's `n`, or the `n` of
 * something that work started.
 */
export function subflowRanges(msgs, p) {
  const out = new Map();
  for (const d of p.delivers) {
    const n = msgs[d].n, mine = new Set(n == null ? [] : [n]);
    let s = -1, e = -1;
    for (const k of p.members) {
      if (k <= d) continue;
      const x = msgs[k];
      if (x.of == null || !mine.has(x.of)) continue;
      if (s < 0) s = k;
      e = k;
      if (x.n != null) mine.add(x.n);
    }
    out.set(d, s < 0 ? { start: d + 1, end: d } : { start: s, end: e });
  }
  return out;
}
