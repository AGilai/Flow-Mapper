// Hop-limited neighbourhoods for the system map. Pure; shared with the browser.

export interface EdgeEnds { from: string; to: string }

/** Ids within `hops` connections of any seed, following edges in both directions. 0 hops = the seeds. */
export function withinHops(seeds: Iterable<string>, edges: EdgeEnds[], hops: number): Set<string> {
  const seen = new Set(seeds);
  if (hops <= 0 || !seen.size) return seen;
  const adj = new Map<string, string[]>();
  for (const e of edges) {
    if (!adj.has(e.from)) adj.set(e.from, []);
    if (!adj.has(e.to)) adj.set(e.to, []);
    adj.get(e.from)!.push(e.to);
    adj.get(e.to)!.push(e.from);
  }
  let frontier = [...seen];
  for (let d = 0; d < hops && frontier.length; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const n of adj.get(id) ?? []) if (!seen.has(n)) { seen.add(n); next.push(n); }
    frontier = next;
  }
  return seen;
}
