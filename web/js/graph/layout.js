// Force-directed layout with group clustering, built for ~1,000 nodes / ~3,000 edges.
// Repulsion uses a spatial grid (only nearby nodes push each other), so each step is ~O(n).
// Nodes in the same group (team) are pulled toward their group's centre, which keeps
// large systems readable as "districts". Deterministic for a given input.

// `fixed`: Map id → {x,y}. Those nodes keep their position; others start at the mean of their
// fixed neighbours. Used to add queues and stores around an existing services layout without moving it.
// `bounds`: Map id -> { x0, y0, x1, y1 } (subsystem regions in a grid of cells): a node starts in the middle of its cell and is kept inside it, so regions never overlap.
// `columnOf`: Map id -> column index (0.28.1, subsystem regions): a strong x spring to the centre of the node's column; columns are as wide as their members need and y stays free.
export function layout(nodes, edges, { iterations = 260, ideal = 80, fixed = null, columnOf = null, bounds = null } = {}) {
  const n = nodes.length;
  const idx = new Map(nodes.map((d, i) => [d.id, i]));
  const x = new Float64Array(n), y = new Float64Array(n), vx = new Float64Array(n), vy = new Float64Array(n);
  const mass = new Float64Array(n).fill(1);

  // Groups placed on a golden-angle spiral; members start near their group centre.
  const groups = [...new Set(nodes.map((d) => d.group ?? ''))];
  const gIndex = new Map(groups.map((g, i) => [g, i]));
  const spread = ideal * Math.sqrt(n) * 0.55;
  const gc = groups.map((_, i) => {
    const r = spread * Math.sqrt((i + 0.5) / groups.length), a = i * 2.39996;
    return [r * Math.cos(a), r * Math.sin(a)];
  });
  let colCx = null;
  if (columnOf) {
    const cnt = new Map();
    for (const d of nodes) { const c = columnOf.get(d.id); if (c != null) cnt.set(c, (cnt.get(c) ?? 0) + 1); }
    colCx = new Map();
    let cur = 0;
    for (const c of [...cnt.keys()].sort((a, b) => a - b)) { const w = Math.max(ideal * 2.2, ideal * Math.sqrt(cnt.get(c)) * 2.1); colCx.set(c, cur + w / 2); cur += w + ideal * 1.2; }
    for (const [c, v] of colCx) colCx.set(c, v - cur / 2);
  }
  let seed = 12345;
  const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff) - 0.5;
  nodes.forEach((d, i) => {
    const c = gc[gIndex.get(d.group ?? '')];
    const col = colCx?.get(columnOf.get(d.id));
    x[i] = (col ?? c[0]) + rand() * ideal * 3;
    y[i] = c[1] + rand() * ideal * 3;
    const bd = bounds?.get(d.id);
    if (bd) { x[i] = (bd.x0 + bd.x1) / 2 + rand() * (bd.x1 - bd.x0) * 0.6; y[i] = (bd.y0 + bd.y1) / 2 + rand() * (bd.y1 - bd.y0) * 0.6; }
  });

  const pinned = new Uint8Array(n);
  if (fixed) {
    const nb = new Map();
    for (const e of edges) {
      for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) if (fixed.has(b) && !fixed.has(a)) { if (!nb.has(a)) nb.set(a, []); nb.get(a).push(fixed.get(b)); }
    }
    nodes.forEach((d, i) => {
      const f = fixed.get(d.id);
      if (f) { x[i] = f.x; y[i] = f.y; pinned[i] = 1; return; }
      const ps = nb.get(d.id);
      if (ps) { x[i] = ps.reduce((a, p) => a + p.x, 0) / ps.length + rand() * ideal; y[i] = ps.reduce((a, p) => a + p.y, 0) / ps.length + rand() * ideal; }
    });
  }

  const E = [];
  for (const e of edges) {
    const a = idx.get(e.from), b = idx.get(e.to);
    if (a == null || b == null || a === b) continue;
    E.push([a, b]);
    mass[a] += 0.25; mass[b] += 0.25;
  }

  const cell = ideal * 2.2;
  const rep = ideal * ideal * 1.6;
  for (let it = 0; it < iterations; it++) {
    const t = 1 - it / iterations;
    const step = 0.08 + 0.9 * t;
    // grid repulsion
    const grid = new Map();
    for (let i = 0; i < n; i++) {
      const k = `${Math.floor(x[i] / cell)},${Math.floor(y[i] / cell)}`;
      let b = grid.get(k);
      if (!b) grid.set(k, (b = []));
      b.push(i);
    }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(x[i] / cell), cy = Math.floor(y[i] / cell);
      for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        const b = grid.get(`${cx + ox},${cy + oy}`);
        if (!b) continue;
        for (const j of b) {
          if (j <= i) continue;
          let dx = x[i] - x[j], dy = y[i] - y[j];
          let d2 = dx * dx + dy * dy;
          if (d2 < 0.01) { dx = rand(); dy = rand(); d2 = 0.5; }
          if (d2 > cell * cell) continue;
          const f = rep / d2;
          const fx = dx * f / Math.sqrt(d2), fy = dy * f / Math.sqrt(d2);
          vx[i] += fx / mass[i]; vy[i] += fy / mass[i];
          vx[j] -= fx / mass[j]; vy[j] -= fy / mass[j];
        }
      }
    }
    // springs
    for (const [a, b] of E) {
      const dx = x[b] - x[a], dy = y[b] - y[a];
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - ideal) * 0.012;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      vx[a] += fx / mass[a]; vy[a] += fy / mass[a];
      vx[b] -= fx / mass[b]; vy[b] -= fy / mass[b];
    }
    // group cohesion + weak centre gravity
    const sum = groups.map(() => [0, 0, 0]);
    for (let i = 0; i < n; i++) { const g = sum[gIndex.get(nodes[i].group ?? '')]; g[0] += x[i]; g[1] += y[i]; g[2]++; }
    for (let i = 0; i < n; i++) {
      const g = sum[gIndex.get(nodes[i].group ?? '')];
      vx[i] += (g[0] / g[2] - x[i]) * 0.006 - x[i] * 0.0005;
      vy[i] += (g[1] / g[2] - y[i]) * 0.006 - y[i] * 0.0005;
      const cc = colCx?.get(columnOf.get(nodes[i].id));
      if (cc != null) vx[i] += (cc - x[i]) * 0.05;
    }
    for (let i = 0; i < n; i++) {
      if (pinned[i]) { vx[i] = 0; vy[i] = 0; continue; }
      const sp = Math.hypot(vx[i], vy[i]);
      const cap = ideal * step;
      const k = sp > cap ? cap / sp : 1;
      x[i] += vx[i] * k; y[i] += vy[i] * k;
      const bd = bounds?.get(nodes[i].id);
      if (bd) { x[i] = Math.max(bd.x0, Math.min(bd.x1, x[i])); y[i] = Math.max(bd.y0, Math.min(bd.y1, y[i])); }
      vx[i] *= 0.55; vy[i] *= 0.55;
    }
  }
  const pos = new Map();
  nodes.forEach((d, i) => pos.set(d.id, { x: x[i], y: y[i] }));
  return pos;
}
