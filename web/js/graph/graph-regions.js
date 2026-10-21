// Subsystem regions on the component-level map (0.28.1, frame 2): a rounded rectangle round the components of each subsystem, drawn under the edges, with
// the subsystem's name and "9 components: 3 new, 6 from prod (2 changed)" in its head. Click the head to open its components in Inventory.

export const REGION_PAD = 28, REGION_HEAD = 40;

/**
 * regionCells(groups) -> Map key -> { x0, y0, x1, y1 }: where the nodes of each group may sit. groups: [{ key, count }] in order. The groups fill a grid of
 * about ceil(sqrt(n)) columns; a cell is as big as its count needs, with room for the region's padding and head, so two regions never overlap.
 */
export function regionCells(groups) {
  const cols = Math.max(1, Math.ceil(Math.sqrt(groups.length))), gap = 60;
  const size = (c) => ({ w: Math.max(380, 100 * Math.sqrt(c) + 260), h: Math.max(230, 90 * Math.sqrt(c) + 130) });
  const colW = [], rowH = [];
  groups.forEach((g, i) => { const s = size(g.count), c = i % cols, r = Math.floor(i / cols); colW[c] = Math.max(colW[c] ?? 0, s.w); rowH[r] = Math.max(rowH[r] ?? 0, s.h); });
  const out = new Map();
  groups.forEach((g, i) => {
    const c = i % cols, r = Math.floor(i / cols);
    const x = colW.slice(0, c).reduce((a, w) => a + w + gap, 0), y = rowH.slice(0, r).reduce((a, h) => a + h + gap, 0), s = size(g.count);
    out.set(g.key, { x0: x + REGION_PAD + 4, y0: y + REGION_PAD + REGION_HEAD + 4, x1: x + s.w - REGION_PAD - 4 - 90, y1: y + s.h - REGION_PAD - 4 });
  });
  return out;
}

/** "9 components: 3 new, 6 from prod (2 changed)", "4 components, all new", "6 components". `hasMarks`: a design with marks (a sealed one has none to count). */
export function regionText(n, newN, chgN, hasMarks) {
  const w = n === 1 ? 'component' : 'components';
  if (!hasMarks || (!newN && !chgN)) return `${n} ${w}`;
  if (newN === n) return `${n} ${w}, all new`;
  if (!newN) return `${n} ${w}: ${chgN} changed`;
  return `${n} ${w}: ${newN} new, ${n - newN} from prod${chgN ? ` (${chgN} changed)` : ''}`;
}

/**
 * regionsOf(nodes, pos, subs, marks) -> [{ key, label, x, y, w, h, ids, text }] in world coordinates, in the environment's subsystem order.
 * nodes: the map's service and gateway nodes (`label` = component name); pos: Map id -> {x, y}; subs: the subsystems store; marks: the marks store.
 * `cells`: the grid cells of regionCells (the region is kept inside its own). A component with no subsystem is in no region.
 */
export function regionsOf(nodes, pos, subs, marks, cells = null) {
  const by = new Map(), hasMarks = marks && !marks.empty;
  for (const n of nodes) {
    if ((n.kind !== 'service' && n.kind !== 'gateway') || !pos.get(n.id)) continue;
    const key = subs.subOf(n.label);
    if (!key) continue;
    if (!by.has(key)) by.set(key, []);
    by.get(key).push(n);
  }
  const order = subs.list().map((s) => s.key);
  return [...by].sort(([a], [b]) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99)).map(([key, ns]) => {
    const ps = ns.map((n) => pos.get(n.id)), xs = ps.map((p) => p.x), ys = ps.map((p) => p.y);
    const kinds = ns.map((n) => marks?.markOf(n.id)?.mark), label = subs.labelOf(key);
    const text = regionText(ns.length, kinds.filter((m) => m === 'new').length, kinds.filter((m) => m === 'changed').length, hasMarks), need = Math.max(label.length * 8.4, text.length * 6.6) + 32; // the head's text always fits
    let minX = Math.min(...xs) - REGION_PAD, maxX = Math.max(...xs) + REGION_PAD;
    if (maxX - minX < need) { const mid = (minX + maxX) / 2; minX = mid - need / 2; maxX = mid + need / 2; }
    const cell = cells?.get(key); // inside its own grid cell: a node on the cell's edge must not push the region into the next one
    if (cell) { const lo = cell.x0 - REGION_PAD - 4, hi = cell.x1 + REGION_PAD + 4; if (minX < lo) { maxX += lo - minX; minX = lo; } if (maxX > hi) { minX = Math.max(lo, minX - (maxX - hi)); maxX = hi; } }
    const minY = Math.min(...ys) - REGION_PAD - REGION_HEAD, maxY = Math.max(...ys) + REGION_PAD;
    return { key, label, x: minX, y: minY, w: maxX - minX, h: maxY - minY, ids: ns.map((n) => n.id), text };
  });
}

/** Draw the regions under the edges. S: the renderer's state view (k, theme, isVis, toScreen). A region none of whose components is shown is skipped. */
export function drawRegions(ctx, S, regions) {
  const { k, theme, isVis, toScreen } = S, z = Math.max(0.6, Math.min(k, 1.2));
  for (const r of regions) {
    if (!r.ids.some(isVis)) continue;
    const [x, y] = toScreen(r), w = r.w * k, h = r.h * k;
    ctx.beginPath(); ctx.roundRect(x, y, w, h, 12 * Math.min(k, 1));
    ctx.globalAlpha = 0.7; ctx.fillStyle = theme.region; ctx.fill(); ctx.globalAlpha = 1; ctx.lineWidth = 1; ctx.strokeStyle = theme.line; ctx.stroke();
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.font = `600 ${13 * z}px ${theme.font}`; ctx.fillStyle = theme.ink; ctx.fillText(r.label, x + 16 * z, y + 24 * z);
    ctx.font = `400 ${11.5 * z}px ${theme.font}`; ctx.fillStyle = theme.muted; ctx.fillText(r.text, x + 16 * z, y + 42 * z);
    ctx.textBaseline = 'middle';
  }
}

/** The region whose head is under a world point, or null (the head is the click target: a click in the empty part of a region still closes the panel). */
export const regionAt = (regions, wx, wy) => regions.find((r) => wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + REGION_HEAD) ?? null;
