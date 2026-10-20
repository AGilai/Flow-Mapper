// Pure helpers that cut a trace's message list into the sync lane and the async work it starts.
// A trace is a depth-first list: a message at depth D owns the messages after it that are deeper. A publish
// (egress into a channel) at depth D starts an async region: the hops out of channels at depth D (its
// deliveries) and everything deeper, until a message at depth <= D that does not come out of a channel.
// No DOM, so tests can import it.

export const isChannel = (id) => typeof id === 'string' && id.startsWith('ch:');
export const isPublish = (m) => m.kind === 'egress' && isChannel(m.to) && !isChannel(m.from);

/** The consumer flow a delivery opens: { service, ingress } or null (not a delivery, broken, unhandled, no target). */
export function asyncFlowOf(m) {
  if (m.kind !== 'deliver' || m.broken || m.unhandled || m.gap || !m.target?.service || !m.target?.ingress) return null;
  return { service: m.target.service, ingress: m.target.ingress };
}

/**
 * Split msgs[lo..hi] into lane messages (indexes) and publishes, each with its region and the deliveries it makes.
 * Returns { lane: number[], publishes: [{ i, end, delivers: number[] }] }; `end` is the last index of the region.
 */
export function scanLane(msgs, lo = 0, hi = msgs.length - 1) {
  const lane = [], publishes = [];
  for (let i = lo; i <= hi; i++) {
    const m = msgs[i];
    if (i > lo && isChannel(m.from) && m.from !== m.to) continue; // a stray hop out of a channel (should sit inside a region)
    lane.push(i);
    if (!isPublish(m)) continue;
    const p = { i, end: i, delivers: [] };
    for (let j = i + 1; j <= hi; j++) {
      const x = msgs[j];
      const hop = isChannel(x.from) && x.from !== x.to && x.depth >= m.depth;
      if (!hop && x.depth <= m.depth) break;
      p.end = j;
      if (x.kind === 'deliver' && x.depth === m.depth && hop) p.delivers.push(j);
    }
    publishes.push(p);
    i = p.end;
  }
  return { lane, publishes };
}

/**
 * The messages of each delivery's own flow: { start, end } (inclusive indexes of what the consumer does, the
 * delivery itself not included) per delivery index; start > end when nothing follows. Deliveries of one fan-out come
 * first and their subtrees after, so a subtree is matched to its delivery by the consumer it runs in, in order.
 */
export function subflowRanges(msgs, p) {
  const out = new Map(), claimed = new Set();
  const depth = msgs[p.i].depth;
  const starts = [];
  for (const d of p.delivers) {
    const m = msgs[d];
    let s = -1;
    for (let k = d + 1; k <= p.end; k++) {
      if (!claimed.has(k) && msgs[k].depth === depth + 1 && msgs[k].from === m.to && !msgs[k].delivery) { s = k; break; }
    }
    if (s >= 0) claimed.add(s);
    starts.push(s);
  }
  const sorted = starts.filter((s) => s >= 0).sort((a, b) => a - b);
  p.delivers.forEach((d, n) => {
    const s = starts[n];
    if (s < 0) { out.set(d, { start: d + 1, end: d }); return; }
    let e = s;
    while (e + 1 <= p.end && msgs[e + 1].depth > depth && !sorted.includes(e + 1)) e++;
    out.set(d, { start: s, end: e });
  });
  return out;
}
