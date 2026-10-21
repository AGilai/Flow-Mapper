// Arrow, hop marker, RPC chip and chain-end drawing: pure shapes, no lane state.

import { s } from '../dom.js';
import { tileW, markW, FUNNEL } from './flow-draw-layout.js';

export const arrowHead = (x, dir, open) => s('path', { d: open ? `M${x - dir * 7} -4L${x} 0L${x - dir * 7} 4` : `M${x - dir * 8} -4L${x} 0L${x - dir * 8} 4z`, class: open ? 'head open' : 'head' });
export const arrow = (x1, x2, y0, { dashed, open, label, italic, color, cross, bare } = {}) => {
  const dir = Math.sign(x2 - x1) || 1;
  return s('g', { class: 'arr', style: `--mc:${color}` },
    s('line', { class: 'arrow', x1, x2: bare ? x2 : x2 - dir * 2, y1: y0, y2: y0, 'stroke-dasharray': dashed ? '5 4' : null }),
    bare ? null : s('g', { transform: `translate(0 ${y0})` }, arrowHead(x2, dir, open)),
    label ? s('text', { class: `label${italic ? ' ret' : ''}`, x: (x1 + x2) / 2, y: y0 - 6, 'text-anchor': 'middle' }, Array.isArray(label) ? [label[0], s('tspan', { class: 'rk' }, ` ${label[1]}`)] : label) : null,
    cross ? s('path', { d: `M${x2 - 5} ${y0 - 5}l10 10M${x2 + 5} ${y0 - 5}l-10 10`, class: 'x' }) : null);
};

// A filter on a hop: a funnel (types, rule, key), a crossed funnel (all but N) or a stack of queues (folded), centred under the arrow.
export const marker = (m, cx, y0, mc) => {
  const w = markW(m), x = cx - w / 2;
  return s('g', { class: `hopmark ${m.kind}`, style: `--mc:${mc}` }, s('rect', { x, y: y0 + 5, width: w, height: 17, rx: 8.5 }),
    m.kind === 'fold' ? null : s('g', { transform: `translate(${x + 6} ${y0 + 8})`, class: 'fun' }, s('path', { d: FUNNEL }), m.kind === 'all-but' ? s('path', { d: 'M1 11L11 1' }) : null),
    s('text', { x: x + (m.kind === 'fold' ? 10 : 22), y: y0 + 17 }, m.label));
};
// An RPC over AMQP: "amqp rpc" under the command's arrow on the first call per caller and server pair ("no server harvested" in red when nothing serves it), a glyph on the later ones.
export const rpcChip = (text, cx, y0, color, bad) => {
  const w = Math.ceil(text.length * 6.8) + 26, x = cx - w / 2;
  return s('g', { class: `rpcchip${bad ? ' bad' : ''}`, style: `--mc:${color}` }, s('rect', { x, y: y0 + 6, width: w, height: 17, rx: 8.5 }), bad ? null : s('text', { class: 'gl', x: x + 7, y: y0 + 18 }, '⇄'), s('text', { x: x + (bad ? 9 : 21), y: y0 + 18 }, text));
};
// The end of the chain: a stop bar across the lifeline at the arrow tip, then the number of each async flow that starts here (or "no reader" / "no consumers").
export const stop = (end, x2, dir, y0, mc, r) => {
  let x = x2 + dir * 9;
  const kids = [s('path', { class: 'stopbar', d: `M${x2} ${y0 - 6}V${y0 + 8}`, style: `stroke:${mc}` })];
  if (end.none) { const w = end.none.length * 8 + 20, bx = dir > 0 ? x : x - w; kids.push(s('g', { class: 'badge warn' }, s('rect', { x: bx, y: y0 + 2, width: w, height: 18, rx: 9 }), s('text', { x: bx + 10, y: y0 + 15 }, end.none))); }
  for (const t of end.tiles) {
    const w = tileW(t.text), bx = dir > 0 ? x : x - w;
    kids.push(s('g', { class: `numtile${t.seen ? ' seen' : ''}${end.bad ? ' bad' : ''}`, 'data-num': t.jump, 'data-own': t.own.join(' '), tabindex: 0, role: 'link', 'aria-label': t.title },
      s('rect', { x: bx, y: y0 + 2, width: w, height: 18, rx: 4 }), s('text', { x: bx + w / 2, y: y0 + 15, 'text-anchor': 'middle' }, t.text), s('title', {}, t.title)));
    x += dir * (w + 4);
  }
  return s('g', { class: 'chain-end' }, ...kids);
};
