// Hit testing for the canvas map: the node or edge under a screen point.

import { nodeRadius } from './graph-style.js';

export function nodeAt(S, sx, sy) {
  const { nodes, isVis, pos, degree, k, toWorld } = S;
  const [wx, wy] = toWorld(sx, sy);
  let best = null, bd = Infinity;
  for (const n of nodes) {
    if (!isVis(n.id)) continue;
    const p = pos.get(n.id), r = nodeRadius(n, degree) + 4 / k;
    const d = Math.hypot(p.x - wx, p.y - wy);
    if (d < r && d < bd) { best = n; bd = d; }
  }
  return best;
}
export function edgeAt(S, sx, sy) {
  const { edges, isVis, edgeOk, highlight, pos, k, toWorld } = S;
  const [wx, wy] = toWorld(sx, sy);
  const tol = 8 / k;
  let best = null, bd = tol;
  for (const e of edges) {
    if (!isVis(e.from) || !isVis(e.to) || (edgeOk && !edgeOk(e)) || (highlight && (!highlight.has(e.from) || !highlight.has(e.to)))) continue;
    const a = pos.get(e.from), b = pos.get(e.to);
    const dx = b.x - a.x, dy = b.y - a.y, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / l2));
    const d = Math.hypot(a.x + t * dx - wx, a.y + t * dy - wy);
    if (d < bd) { best = e; bd = d; }
  }
  return best;
}
