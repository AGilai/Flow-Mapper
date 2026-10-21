// Canvas drawing of the map's edges (batched by style, arrowheads when zoomed in) and team district labels.
// S is the renderer's state view built by canvas-graph.js at draw time.

import { edgeStyle, nodeRadius } from './graph-style.js';

/** Team districts: label at the centroid when zoomed out. */
export function drawDistricts(ctx, S) {
  const { k, theme, groups, toScreen } = S;
  if (k < 1.1) {
    ctx.font = `600 ${Math.max(12, 15 * Math.min(1, k * 1.4))}px ${theme.font}`;
    ctx.textAlign = 'center';
    ctx.fillStyle = theme.district;
    const used = [];
    for (const g of [...groups].sort((a, b) => b.size - a.size)) {
      const [sx, sy] = toScreen(g);
      const tw = ctx.measureText(g.name).width;
      const box = [sx - tw / 2 - 6, sy - 10, tw + 12, 20];
      if (used.some((b) => box[0] < b[0] + b[2] && box[0] + box[2] > b[0] && box[1] < b[1] + b[3] && box[1] + box[3] > b[1])) continue;
      used.push(box);
      ctx.fillText(g.name, sx, sy);
    }
  }
}

/** Edges, batched by style. Quieter as the map gets denser. */
export function drawEdges(ctx, S, focus, dimmed) {
  const { quiet, edges, isVis, edgeOk, hoverSet, hovered, highlight, selected, theme, byId, degree, k, toScreen, pos } = S;
  const density = Math.max(0, Math.min(1, 1 - (edges.length - 60) / 600));
  const batches = new Map();
  for (const e of edges) {
    if (!isVis(e.from) || !isVis(e.to) || (edgeOk && !edgeOk(e))) continue;
    // With a centre (hovered/selected node), only its own edges are in focus.
    const center = hoverSet ? hovered : highlight && selected && highlight.has(selected) ? selected : null;
    const inFocus = focus && (center ? e.from === center || e.to === center : !dimmed(e.from) && !dimmed(e.to));
    const st = edgeStyle(e, theme, {
      dim: !!focus && !inFocus, focused: !!inFocus, selected: selected === e.id,
      gateway: byId.get(e.from)?.kind === 'gateway' || byId.get(e.to)?.kind === 'gateway', density, quiet: !!quiet?.(e),
    });
    const key = `${st.color}|${st.dash}|${st.alpha}|${st.width}`;
    if (!batches.has(key)) batches.set(key, { st, list: [] });
    batches.get(key).list.push(e);
  }
  for (const { st, list } of batches.values()) {
    ctx.strokeStyle = st.color; ctx.globalAlpha = st.alpha; ctx.lineWidth = st.width;
    ctx.setLineDash(st.dash ? [4, 3] : []);
    ctx.beginPath();
    for (const e of list) {
      const [ax, ay] = toScreen(pos.get(e.from)), [bx, by] = toScreen(pos.get(e.to));
      ctx.moveTo(ax, ay); ctx.lineTo(bx, by);
      if (k > 1.15) { // arrowhead at the target's edge
        const r = nodeRadius(byId.get(e.to), degree) * Math.max(0.5, Math.min(k, 1.25)) + 2;
        const ang = Math.atan2(by - ay, bx - ax), ex = bx - Math.cos(ang) * r, ey = by - Math.sin(ang) * r;
        ctx.moveTo(ex - Math.cos(ang - 0.4) * 6, ey - Math.sin(ang - 0.4) * 6); ctx.lineTo(ex, ey);
        ctx.lineTo(ex - Math.cos(ang + 0.4) * 6, ey - Math.sin(ang + 0.4) * 6);
      }
    }
    ctx.stroke();
  }
  ctx.setLineDash([]); ctx.globalAlpha = 1;
}
