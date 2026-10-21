// Node and edge styling for the canvas map. Shapes encode kind; colours encode transport.
//   service  circle      gateway  rounded square (ink)     missing  dashed red ring
//   channel  diamond in its transport colour               resource small square (grey)
// Nodes with an object icon (AWS service icon or brand logo, see components/object-icon.js) draw
// the icon instead of the shape.

import { isDesign, state } from '../state.js';
import { slotOf } from '../design/component-colors.js';

export function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const v = (n) => cs.getPropertyValue(n).trim();
  return {
    font: v('--font') || 'sans-serif', ink: v('--ink'), ink2: v('--ink-2'), muted: v('--muted'), surface: v('--surface'),
    paper: v('--paper'), line: v('--line-strong'), accent: v('--accent'), broken: isDesign() ? v('--ink-2') : v('--t-broken'), halo: v('--paper'),
    cmp: [1, 2, 3, 4, 5, 6, 7, 8].map((i) => v(`--cmp-${i}`)), district: v('--muted'), newc: v('--new'), newInk: v('--new-ink'),
    t: { http: v('--t-http'), rpc: v('--t-rpc'), grpc: v('--t-http'), eventbridge: v('--t-eb'), sns: v('--t-sns'), sqs: v('--t-sqs'), amqp: v('--t-amqp'), cron: v('--t-cron'), socket: v('--t-socket'), other: v('--t-res'), undecided: v('--ink-2'), res: v('--t-res') },
  };
}

export function nodeRadius(n, degree) {
  if (!n) return 6;
  const d = degree.get(n.id) ?? 0;
  if (n.kind === 'channel' || n.kind === 'resource') return 7;
  if (n.kind === 'missing') return 5;
  return Math.min(n.kind === 'gateway' ? 13 : 15, 5 + Math.sqrt(d) * 1.1);
}

const channelColor = (n, theme) => theme.t[(n.transports ?? [])[0]] ?? theme.t.other;

export function drawNode(ctx, n, [x, y], k, degree, theme, { dim, selected, hovered, img }) {
  const r = nodeRadius(n, degree) * Math.max(0.5, Math.min(k, 1.25));
  ctx.globalAlpha = dim ? 0.18 : 1;
  ctx.lineWidth = selected ? 3 : hovered ? 2.4 : 1.6;
  if (img) {
    const s = Math.max(12, r * 2);
    if (selected || hovered) { ctx.strokeStyle = selected ? theme.accent : theme.ink2; roundRect(ctx, x - s / 2 - 3, y - s / 2 - 3, s + 6, s + 6, 5); ctx.stroke(); }
    ctx.drawImage(img, x - s / 2, y - s / 2, s, s);
  } else if (n.kind === 'channel') {
    ctx.fillStyle = channelColor(n, theme);
    ctx.beginPath(); ctx.moveTo(x, y - r * 1.25); ctx.lineTo(x + r * 1.25, y); ctx.lineTo(x, y + r * 1.25); ctx.lineTo(x - r * 1.25, y); ctx.closePath();
    ctx.fill();
    if (selected || hovered) { ctx.strokeStyle = theme.ink; ctx.stroke(); }
  } else if (n.kind === 'resource') {
    ctx.fillStyle = theme.surface; ctx.strokeStyle = theme.t.res;
    ctx.beginPath(); ctx.rect(x - r, y - r, r * 2, r * 2); ctx.fill(); ctx.stroke();
  } else if (n.kind === 'missing') {
    ctx.strokeStyle = theme.broken; ctx.fillStyle = theme.surface;
    ctx.setLineDash([3, 2]); ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  } else if (n.kind === 'gateway') {
    ctx.fillStyle = theme.ink; ctx.strokeStyle = selected ? theme.accent : theme.ink;
    roundRect(ctx, x - r, y - r, r * 2, r * 2, r * 0.35); ctx.fill(); if (selected) ctx.stroke();
  } else {
    const broken = n.stats && (n.stats.dangling > 0);
    ctx.fillStyle = theme.surface;
    const slot = slotOf(state.envMeta, state.env, n.service, n.svcKind); // the component's colour ring (frame 11); client apps and infra stay neutral
    ctx.strokeStyle = selected ? theme.accent : broken ? theme.broken : slot ? theme.cmp[slot - 1] : theme.ink2;
    if (slot && !selected && !broken) ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // inner dot sized by function count: a quick sense of how much is inside
    const f = n.stats?.functions ?? 0;
    if (f && r > 6) { ctx.fillStyle = selected ? theme.accent : theme.ink2; ctx.beginPath(); ctx.arc(x, y, Math.min(r - 3, 1.5 + Math.sqrt(f) * 0.45), 0, Math.PI * 2); ctx.fill(); }
  }
  if (n.runtime && n.kind !== 'channel' && n.kind !== 'resource') heptagon(ctx, x - r * 0.95, y - r * 0.95, Math.max(3.5, r * 0.4), theme.ink2); // Kubernetes runtime (#49): a heptagon outline, not a brand logo
  ctx.globalAlpha = 1;
}

function heptagon(ctx, cx, cy, r, color) {
  ctx.beginPath();
  for (let i = 0; i < 7; i++) { const a = -Math.PI / 2 + (i * 2 * Math.PI) / 7; ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
  ctx.closePath(); ctx.fillStyle = 'transparent'; ctx.strokeStyle = color; ctx.lineWidth = 1.2; ctx.stroke();
}

/** Edges are quiet at rest so a dense map stays legible; focus (hover/select) brings them forward.
 *  Gateway edges connect to almost everything, so they are quieter still unless focused. */
export function edgeStyle(e, theme, { dim, focused, selected, gateway, density = 1 }) {
  const t = e.broken ? null : e.transports.find((x) => x !== 'other') ?? 'other';
  const color = e.broken ? theme.broken : selected ? theme.accent : theme.t[t] ?? theme.t.other;
  const async = !e.broken && e.modes.includes('async') && !e.modes.includes('sync');
  // density: 1 for small maps, falling toward 0 as the edge count grows.
  const base = 0.22 + 0.5 * density;
  const rest = e.broken ? 0.7 : gateway ? base * 0.35 : t === 'other' ? base * 0.8 : base;
  const alpha = dim ? 0.04 : selected ? 1 : focused ? 0.85 : rest;
  return { color, dash: e.broken || async, alpha, width: selected ? 2.5 : focused ? 1.6 : 1 };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
