// The subsystem level's geometry (0.28.1, frame 3), pure: boxes on a grid in the environment's order, the routes of the rolled-up lines and the abstract
// links between them, thickness and label places. No DOM. The drawing is views/subsystem-draw.js.

export const BOX_W = 232, GAP_X = 128, GAP_Y = 72, HEAD_H = 80, ROW_H = 20, MAX_ROWS = 10, PAD = 20, SPACING = 30, MAX_LINES = 6;

const MIN_SCALE = 0.78;
const needed = (c) => PAD * 2 + c * BOX_W + (c - 1) * GAP_X;
/**
 * { cols, scale } for `width` px: as many columns as fit (1 to 4, never more than `count` boxes), the drawing shrinking to 78% to keep one more column.
 * Up to three boxes stay in one row whatever the width (the stage scrolls): stacked, the calls between them would have no room for their labels.
 */
export function gridFor(width, count = 4) {
  if (count <= 3) return { cols: Math.max(1, count), scale: Math.max(MIN_SCALE, Math.min(1, width / needed(Math.max(1, count)))) };
  for (let c = Math.min(4, count); c > 1; c--) if (needed(c) * MIN_SCALE <= width) return { cols: c, scale: Math.min(1, width / needed(c)) };
  return { cols: 1, scale: 1 };
}

/** The stroke width of a roll-up line: 1.5 + log2(count). */
export const thickness = (count) => Math.round((1.5 + Math.log2(Math.max(1, count))) * 10) / 10;

/**
 * layoutBoxes(boxes, { cols }) -> { boxes: Map key -> { key, x, y, w, h, col, row, rows: [{ name, y }], more }, width, height, rowBottom: [y] }
 * boxes: SubsystemMap.boxes (env order). Each box lists at most MAX_ROWS component names and "+N more"; the boxes of a grid row are as tall as the tallest.
 */
export function layoutBoxes(boxes, { cols = 4 } = {}) {
  const n = Math.min(cols, Math.max(1, boxes.length)), shown = (b) => Math.min(MAX_ROWS, b.components.length);
  const own = boxes.map((b) => HEAD_H + (shown(b) + (b.components.length > MAX_ROWS ? 1 : 0)) * ROW_H + 22);
  const rowsN = Math.ceil(boxes.length / n), heights = [], tops = [];
  for (let r = 0, y = PAD; r < rowsN; r++) { heights[r] = Math.max(...own.slice(r * n, r * n + n)); tops[r] = y; y += heights[r] + GAP_Y; }
  const out = new Map();
  boxes.forEach((b, i) => {
    const col = i % n, row = Math.floor(i / n), x = PAD + col * (BOX_W + GAP_X), y = tops[row];
    out.set(b.key, { key: b.key, x, y, w: BOX_W, h: heights[row], col, row, more: Math.max(0, b.components.length - MAX_ROWS),
      rows: b.components.slice(0, MAX_ROWS).map((c, k) => ({ name: c.name, y: y + HEAD_H + k * ROW_H + 14 })) });
  });
  const width = PAD * 2 + n * BOX_W + (n - 1) * GAP_X + (n === 1 ? 110 : 0), rowBottom = tops.map((t, r) => t + heights[r]);
  return { boxes: out, width, height: rowBottom[rowBottom.length - 1] + PAD + 90, rowBottom };
}

/**
 * collapseLines(lines) -> the lines to draw: more than MAX_LINES lines between the same two subsystems (either direction) become one per direction,
 * "N calls · M transports", with every call kept (`calls`, `ids`). Other lines pass through.
 */
export function collapseLines(lines, max = MAX_LINES) {
  const by = new Map();
  for (const l of lines) { const k = [l.from, l.to].sort().join('\u0000'); if (!by.has(k)) by.set(k, []); by.get(k).push(l); }
  return [...by.values()].flatMap((g) => {
    if (g.length <= max) return g;
    const dirs = new Map();
    for (const l of g) { const k = `${l.from}>${l.to}`; if (!dirs.has(k)) dirs.set(k, []); dirs.get(k).push(l); }
    return [...dirs.values()].map((ls) => ls.length === 1 ? ls[0] : {
      id: `all:${ls[0].from}>${ls[0].to}`, from: ls[0].from, to: ls[0].to, transport: 'many', mode: ls.every((l) => l.mode === ls[0].mode) ? ls[0].mode : 'sync',
      count: ls.reduce((s, l) => s + l.count, 0), calls: ls.flatMap((l) => l.calls), links: ls.flatMap((l) => l.links), ids: ls.map((l) => l.id), transports: [...new Set(ls.map((l) => l.transport))] });
  });
}

/**
 * routeItems(items, L) -> Map id -> { d, from: [x, y], to: [x, y], lx, ly }
 * items: [{ id, from, to (box keys), fromY?, toY? }] in drawing order: parallel items of one pair of boxes are SPACING apart, both directions side by side.
 * `fromY` / `toY`: the y of a component row an end points at (an abstract link narrowed to a component). Boxes on one grid row that are not neighbours
 * are joined underneath the row, so a line never crosses a box. L: layoutBoxes().
 */
export function routeItems(items, L) {
  const pairs = new Map(), low = new Map(), gutter = new Map(), out = new Map();
  for (const it of items) { const k = [it.from, it.to].sort().join('\u0000'); pairs.set(k, [...(pairs.get(k) ?? []), it]); }
  for (const g of pairs.values()) {
    g.forEach((it, i) => {
      const A = L.boxes.get(it.from), B = L.boxes.get(it.to), off = (i - (g.length - 1) / 2) * SPACING;
      if (!A || !B) return;
      if (A === B) { const y = A.y + HEAD_H + 10 + i * 16; out.set(it.id, { d: `M${A.x + A.w} ${y} h28 v14 h-28`, from: [A.x + A.w, y], to: [A.x + A.w, y + 14], lx: A.x + A.w + 34, ly: y + 10 }); return; }
      const dc = B.col - A.col, dr = B.row - A.row;
      if (dr === 0 && Math.abs(dc) > 1) { // under the row
        const lane = low.get(A.row) ?? 0; low.set(A.row, lane + 1);
        const yl = L.rowBottom[A.row] + 26 + lane * 22, xa = A.x + A.w / 2 + off, xb = B.x + B.w / 2 + off, ya = A.y + A.h, yb = B.y + B.h;
        out.set(it.id, { d: `M${xa} ${ya} V${yl} H${xb} V${yb}`, from: [xa, ya], to: [xb, yb], lx: (xa + xb) / 2, ly: yl - 6 });
        return;
      }
      if (dc === 0 && Math.abs(dr) > 1) { // not neighbours in a column: round the right side
        const gl = gutter.get(A.col) ?? 0; gutter.set(A.col, gl + 1);
        const gx = A.x + A.w + 26 + gl * 18, ya = A.y + 44 + off, yb = B.y + 44 + off;
        out.set(it.id, { d: `M${A.x + A.w} ${ya} H${gx} V${yb} H${B.x + B.w}`, from: [A.x + A.w, ya], to: [B.x + B.w, yb], lx: gx + 6, ly: (ya + yb) / 2, anchor: 'start' });
        return;
      }
      if (dc === 0) { // one above the other
        const down = dr > 0, x = A.x + A.w / 2 + off, ya = down ? A.y + A.h : A.y, yb = down ? B.y : B.y + B.h;
        out.set(it.id, { d: `M${x} ${ya} V${yb}`, from: [x, ya], to: [x, yb], lx: x + 8, ly: (ya + yb) / 2, anchor: 'start' });
        return;
      }
      const right = dc > 0, xa = right ? A.x + A.w : A.x, xb = right ? B.x : B.x + B.w;
      const ya = it.fromY ?? (A.y + A.h / 2 + off), yb = it.toY ?? (dr === 0 ? ya : B.y + B.h / 2 + off), mx = (xa + xb) / 2;
      out.set(it.id, { d: dr === 0 && ya === yb ? `M${xa} ${ya} H${xb}` : `M${xa} ${ya} C${mx} ${ya} ${mx} ${yb} ${xb} ${yb}`, from: [xa, ya], to: [xb, yb], lx: mx, ly: (ya + yb) / 2 - 6 });
    });
  }
  spreadLabels(out);
  return out;
}

/** Nudge labels that would sit on each other (same place within 13px up or down and 120px across) down a line each. */
function spreadLabels(routes) {
  const placed = [];
  for (const r of [...routes.values()].sort((a, b) => a.ly - b.ly || a.lx - b.lx)) {
    while (placed.some((p) => Math.abs(p.ly - r.ly) < 13 && Math.abs(p.lx - r.lx) < 120)) r.ly += 13;
    placed.push(r);
  }
}

/** "2 calls · http", "1 async · amqp", "9 calls · 3 transports". */
export function lineLabel(l) {
  if (l.transports) return `${l.count} calls · ${l.transports.length} transports`;
  return `${l.count} ${l.mode === 'async' ? 'async' : l.count === 1 ? 'call' : 'calls'} · ${l.transport}`;
}

/** The lines and links to route, in drawing order: roll-up lines (collapsed past 6 per pair), then the abstract links still at this level (a refined one is part of its line). */
export function itemsOf(map, L, { rolled = true, abstract = true } = {}) {
  const lines = rolled ? collapseLines(map.lines) : [];
  const links = abstract ? map.abstract.filter((v) => v.state !== 'refined') : [];
  const rowY = (end) => (end.level === 'subsystem' ? undefined : (L.boxes.get(end.subsystem)?.rows.find((r) => r.name === end.service)?.y ?? 0) - 4 || undefined);
  return { lines, links, items: [...lines.map((l) => ({ id: l.id, from: l.from, to: l.to })), ...links.map((v) => ({ id: `link:${v.id}`, from: v.from.subsystem, to: v.to.subsystem, fromY: rowY(v.from), toY: rowY(v.to) }))] };
}
