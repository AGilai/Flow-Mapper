// One SVG group per event row: calls, returns, unresolved calls, publish hops, AMQP notes, store stubs, frontier, middleware and internal-call pills.

import { s } from '../dom.js';
import { href } from '../router.js';
import { mwLabel, isLongChain } from './flow-mw.js';
import { colorOf } from './flow-draw-layout.js';
import { arrow, marker, rpcChip, stop } from './flow-draw-prims.js';
import { arrowMarkSvg } from './flow-marks-draw.js';
import { isDesign } from '../state.js';
import { refNoteSvg } from './flow-refs-draw.js';

/** drawRows(layout) -> one element per event, in order. */
export function drawRows({ events, colX, ys, barX, edge, marks, refs }) {
  return events.map((e, r) => {
    const y0 = ys[r];
    const g = (cls, ...kids) => s('g', { class: `msg ${cls}`, 'data-e': r, tabindex: e.msg ? 0 : null, role: e.msg ? 'button' : null }, ...kids);
    const hit = (x1, x2) => s('rect', { class: 'hit', x: Math.min(x1, x2) - 4, y: y0 - 22, width: Math.abs(x2 - x1) + 8, height: 30 });
    // the shared trunk of a fan-out (service to topic): opens the publish, not the first delivery (0.19.1)
    const trunkHit = (x1, x2, y, ev) => s('rect', { class: 'hit trunk', x: Math.min(x1, x2) - 4, y: y - 22, width: Math.abs(x2 - x1) + 4, height: 30, tabindex: 0, role: 'button', 'aria-label': `Publish ${ev.label}, fans out to ${ev.publish.deliveries.length} queues` });
    const owner = e.fromBar ?? e.bar;
    if (e.type === 'call') {
      const dir = Math.sign(colX.get(e.to) - colX.get(e.from)) || 1;
      const x1 = edge(e.fromBar, e.from, dir), x2 = e.bar ? barX(e.bar, -dir) : colX.get(e.to);
      const mc = colorOf(e.tr ?? e.msg.transport);
      return g(e.rpc ? 'rpc' : '', arrow(x1, x2, y0, { label: e.label, color: mc, dashed: e.msg.mode === 'async' && !e.bar }), e.rpc?.chip ? rpcChip('amqp rpc', (x1 + x2) / 2, y0, mc) : null, e.rpc?.glyph ? s('text', { class: 'rpcglyph', x: Math.min(x1, x2) + 4, y: y0 - 5, style: `--mc:${mc}` }, '⇄') : null, hit(x1, x2), ...arrowMarkSvg(marks, e.msg, x1, x2, y0), e.bar ? refNoteSvg(refs, e, barX(e.bar, 1), y0) : null, s('title', {}, e.rpc ? `${e.label} (RPC over AMQP)` : e.msg.label));
    }
    if (e.type === 'return') {
      const dir = Math.sign(colX.get(e.to) - colX.get(e.bar.col)) || 1;
      const x1 = barX(e.bar, dir), x2 = e.bar.parent ? barX(e.bar.parent, -dir) : colX.get(e.to);
      return s('g', { class: 'msg ret-msg' }, arrow(x1, x2, y0, { dashed: true, open: true, italic: true, label: e.label, color: colorOf(e.bar.transport) }));
    }
    if (e.type === 'unresolved') {
      const x1 = barX(owner, 1), x2 = colX.get(e.col) - 8;
      const gap = isDesign(); // in a design a missing target is not a fault: neutral, no cross
      return g('broken', arrow(x1, x2, y0, { dashed: true, label: e.label, color: gap ? 'var(--ink-2)' : 'var(--t-broken)', cross: !gap }), e.chip ? rpcChip(e.chip, (x1 + x2) / 2, y0, 'var(--t-broken)', true) : arrowMarkSvg(null, e.msg, x1, x2, y0), hit(x1, x2), s('title', {}, e.msg.label));
    }
    if (e.type === 'hop') { // one arrow through the topic: its colour changes exactly on the topic lifeline; the event type reads like a REST path
      const x1 = edge(e.fromBar, e.from, 1), x2 = colX.get(e.to), tx = e.via ? colX.get(e.via) : e.fork ? colX.get(e.from) : null, mc = colorOf(e.transport), tc = colorOf(e.trunkTransport), hl = e.sub ? [e.label, e.sub] : e.label;
      let kids, left = x1, mid;
      if (e.via) { kids = [arrow(x1, tx, y0, { label: hl, color: tc, bare: true }), arrow(tx, x2, y0, { color: mc }), s('circle', { class: 'via', cx: tx, cy: y0, r: 3.2, style: `--mc:${mc}` })]; mid = (tx + x2) / 2; }
      else if (e.fork) { // a branch: leaves the topic lifeline downwards from the arrow above it and turns right
        left = tx; mid = (tx + 6 + x2) / 2;
        kids = [s('path', { class: 'fork', d: `M${tx} ${ys[r - 1]}V${y0 - 7}Q${tx} ${y0} ${tx + 7} ${y0}`, style: `--mc:${mc}` }), arrow(tx + 6, x2, y0, { color: mc })];
      } else { kids = [arrow(x1, x2, y0, { label: e.trunk ? hl : null, color: mc })]; mid = (x1 + x2) / 2; }
      return g('hop', ...kids, e.marker ? marker(e.marker, mid, y0, mc) : null, e.end ? stop(e.end, x2, 1, y0, mc, r) : null, ...(e.publish ? [trunkHit(x1, tx, y0, e), hit(tx, x2)] : [hit(left, x2)]), s('title', {}, [e.msg.label, e.marker?.full].filter(Boolean).join('\n')));
    }
    if (e.type === 'amqpnote') { // the bindings that do not route this publish, under the fork; the exchange page lists them
      const x0 = colX.get(e.col) + 10;
      return s('g', { class: 'amqpnote' }, s('text', { x: x0, y: y0 + 4 }, e.text),
        s('a', { href: href(`/instances/${encodeURIComponent('amqp:' + e.exchange)}`), 'aria-label': `Exchange page of ${e.exchange}` }, s('text', { class: 'lnk', x: x0 + e.text.length * 5.6 + 12, y: y0 + 4 }, 'Exchange page'), s('title', {}, `Open the exchange ${e.exchange}`)));
    }
    if (e.type === 'store') {
      const x0 = barX(e.bar, 1), w = Math.max(e.verb.length * 7, e.name.length * 6) + 18;
      return g('store', s('line', { class: 'stub', x1: x0, x2: x0 + 14, y1: y0, y2: y0 }), s('rect', { class: 'spill', x: x0 + 14, y: y0 - 16, width: w, height: 32, rx: 6 }),
        s('text', { class: 'p1', x: x0 + 23, y: y0 - 2 }, e.verb), s('text', { class: 'p2', x: x0 + 23, y: y0 + 11 }, e.name), s('title', {}, `${e.msg.label}\n${e.msg.store ?? ''}`));
    }
    if (e.type === 'frontier') {
      const x0 = barX(e.bar, 1);
      return g('frontier', s('path', { class: 'stub', d: `M${x0} ${y0} h10` }), s('text', { class: 'label', x: x0 + 16, y: y0 + 4 }, `${e.msg.label}  (click to show)`));
    }
    if (e.type === 'mw') {
      const x0 = barX(e.bar, 1), text = mwLabel(e.seg, e.internal), fold = isLongChain(e.bar.mw.chain), chev = e.seg.folded || e.seg.collapse, w = text.length * 6.4 + 16 + (chev ? 18 : 0), cx = x0 + 12 + w - 14;
      return s('g', { class: `note mwlab${fold ? ' fold' : ''}${e.gaps ? ' warn' : ''}`, 'data-pill': fold ? null : e.bar.id, 'data-mwfold': fold ? e.bar.id : null, tabindex: 0, role: 'button' }, s('path', { class: 'tick', d: `M${x0} ${y0} h12` }),
        s('rect', { x: x0 + 12, y: y0 - 11, width: w, height: 22, rx: 11 }), s('text', { x: x0 + 20, y: y0 + 4 }, text),
        chev ? s('path', { class: 'chev', d: e.seg.collapse ? `M${cx - 5} ${y0 - 2.5} l5 5 l5 -5` : `M${cx - 2.5} ${y0 - 5} l5 5 l-5 5` }) : null,
        s('title', {}, fold ? 'Click to expand or collapse the middleware chain' : 'Middleware that runs before the handler. Click to look inside.'));
    }
    const n = e.bar.internal.n, gaps = e.bar.internal.gaps, x0 = barX(e.bar, 1);
    const text = `${n} internal ${n === 1 ? 'call' : 'calls'}${gaps ? ` · ${gaps} unresolved` : ''} ▸`;
    return s('g', { class: `note${gaps ? ' warn' : ''}`, 'data-pill': e.bar.id, tabindex: 0, role: 'button' }, s('path', { class: 'tick', d: `M${x0} ${y0} h12` }),
      s('rect', { x: x0 + 12, y: y0 - 11, width: text.length * 6.4 + 16, height: 22, rx: 11 }), s('text', { x: x0 + 20, y: y0 + 4 }, text), s('title', {}, 'Calls inside this service are folded. Click to see them.'));
  });
}
