// Canvas drawing of node labels: most important first, none that would overlap one already drawn.

import { nodeRadius } from './graph-style.js';

const EXT_W = 52;

export function drawLabels(ctx, S, order, focus, dimmed) {
  const { selected, hovered, degree, k, toScreen, pos, w, hgt, theme } = S;
  const placed = [];
  const ranked = order
    .map((n) => ({ n, score: (selected === n.id ? 1e6 : 0) + (hovered === n.id ? 1e5 : 0) + (focus?.has(n.id) ? 1e4 : 0) + (degree.get(n.id) ?? 0) + (n.kind === 'gateway' ? 50 : 0) }))
    .sort((a, b) => b.score - a.score);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  for (const { n, score } of ranked) {
    if (dimmed(n.id)) continue;
    const r = nodeRadius(n, degree) * Math.max(0.5, Math.min(k, 1.25));
    const important = score >= 1e4 || (n.kind !== 'channel' && n.kind !== 'resource') ;
    if (!important && k < 1.6) continue;
    if (placed.length > 160) break;
    const [sx, sy] = toScreen(pos.get(n.id));
    if (sx < -50 || sy < -20 || sx > w + 50 || sy > hgt + 20) continue;
    ctx.font = `${n.kind === 'channel' || n.kind === 'resource' ? 400 : 600} ${n.kind === 'channel' || n.kind === 'resource' ? 11 : 12}px ${theme.font}`;
    const tw = ctx.measureText(n.label).width, tag = n.external ? EXT_W : 0; // #87: the "external" text tag after the name
    const box = [sx + r + 4, sy - 8, tw + 4 + tag, 16];
    if (placed.some((b) => box[0] < b[0] + b[2] && box[0] + box[2] > b[0] && box[1] < b[1] + b[3] && box[1] + box[3] > b[1])) continue;
    placed.push(box);
    ctx.fillStyle = theme.halo;
    ctx.fillRect(box[0] - 1, box[1] + 1, box[2], box[3] - 2);
    ctx.fillStyle = n.kind === 'missing' ? theme.broken : theme.ink;
    ctx.fillText(n.label, box[0] + 1, sy);
    if (n.external) { ctx.font = `600 10px ${theme.font}`; ctx.fillStyle = theme.extInk; ctx.fillText('external', box[0] + tw + 7, sy); }
  }
}
