// One SVG group per event row: calls, returns, unresolved calls, publish hops, AMQP notes, store stubs, frontier, middleware and internal-call pills.

import { s } from '../dom.js';
import { href } from '../router.js';
import { mwLabel, isLongChain } from './flow-mw.js';
import { colorOf, BAR } from './flow-draw-layout.js';
import { arrow, marker, rpcChip, stop } from './flow-draw-prims.js';
import { arrowMarkSvg } from './flow-marks-draw.js';
import { isDesign } from '../state.js';
import { refNoteSvg } from './flow-refs-draw.js';
import { noteSvg } from './flow-draw-notes.js';
import { decisionSvg } from './flow-decision-draw.js';
import { inlineMarks } from './flow-markers-draw.js';
import { frontierSvg, blockedBand, blockedLines, blockedIcall, isBlockedEvent, inferredTag, BLOCKED_LINE } from './flow-draw-incomplete.js';
import { isInferred } from './incomplete-pure.js';

/** "⌄ group": folds an expanded run of DB operations again (0.38.0); a folded run opens with a click on its row. */
const dbToggle = (key, x, y0) => s('g', { class: 'dbtog', 'data-db': key, tabindex: 0, role: 'button', 'aria-label': 'Group these database operations again' }, s('rect', { x, y: y0 + 5, width: 58, height: 15, rx: 7.5 }), s('text', { x: x + 29, y: y0 + 16, 'text-anchor': 'middle' }, '⌄ group'), s('title', {}, 'Group these operations into one row again'));

/** drawRows(layout) -> one element per event, in order. */
export function drawRows({ events, colX, ys, barX, edge, marks, refs, stacked, folded, idx, groups = [], noApi = null, th = true, width = 0, decide = null, runs = null }) {
  return events.map((e, r) => {
    const y0 = ys[r], lab = (v) => (noApi?.has(e) ? null : v), mk = () => ({ ow: runs?.byMsg.get(e.msg)?.first, label: lab(e.label) }); // 0.38.1: the step markers (flow-markers-draw.js) // step details: an arrow that shows title / description only has no API label
    const g = (cls, ...kids) => s('g', { class: `msg ${cls}`, 'data-e': r, tabindex: e.msg ? 0 : null, role: e.msg ? 'button' : null }, ...kids);
    const hit = (x1, x2) => s('rect', { class: 'hit', x: Math.min(x1, x2) - 4, y: y0 - 22, width: Math.abs(x2 - x1) + 8, height: 30 });
    // the shared trunk of a fan-out (service to topic): opens the publish, not the first delivery (0.19.1)
    const trunkHit = (x1, x2, y, ev) => s('rect', { class: 'hit trunk', x: Math.min(x1, x2) - 4, y: y - 22, width: Math.abs(x2 - x1) + 4, height: 30, tabindex: 0, role: 'button', 'aria-label': `Publish ${ev.label}, fans out to ${ev.publish.deliveries.length} queues` });
    const owner = e.fromBar ?? e.bar;
    if (e.type === 'call') {
      const dir = Math.sign(colX.get(e.to) - colX.get(e.from)) || 1;
      const x1 = edge(e.fromBar, e.from, dir), x2 = e.bar ? barX(e.bar, -dir) : colX.get(e.to);
      const mc = colorOf(e.tr ?? e.msg.transport);
      const inf = isInferred(e.msg); // reserved (#85 ask 5): a hop a model inferred is dash-dot with a tag, never amber, solid or grey
      return g(`${e.rpc ? 'rpc' : ''}${inf ? ' inferred' : ''}`, arrow(x1, x2, y0, { label: lab(e.label), color: mc, dashed: e.msg.mode === 'async' && !e.bar }), inf ? inferredTag(Math.min(x1, x2) + 8, y0) : null, e.rpc?.chip ? rpcChip('amqp rpc', (x1 + x2) / 2, y0, mc) : null, e.rpc?.glyph ? s('text', { class: 'rpcglyph', x: Math.min(x1, x2) + 4, y: y0 - 5, style: `--mc:${mc}` }, '⇄') : null, hit(x1, x2), ...arrowMarkSvg(marks, e.msg, x1, x2, y0, stacked?.has(e), th, mk()), e.bar ? refNoteSvg(refs, e, barX(e.bar, 1), y0) : null, s('title', {}, e.rpc ? `${e.label} (RPC over AMQP)` : e.msg.label));
    }
    if (e.type === 'return') {
      const dir = Math.sign(colX.get(e.to) - colX.get(e.bar.col)) || 1;
      const x1 = barX(e.bar, dir), x2 = e.bar.parent ? barX(e.bar.parent, -dir) : colX.get(e.to);
      return s('g', { class: 'msg ret-msg' }, arrow(x1, x2, y0, { dashed: true, open: true, italic: true, label: e.label, color: colorOf(e.bar.transport) }), e.returns?.detail ? s('title', {}, `${e.label}\n${e.returns.detail}`) : null);
    }
    if (e.type === 'unresolved') {
      const x1 = barX(owner, 1), x2 = colX.get(e.col) - 8;
      const gap = isDesign(e.col?.env), blk = isBlockedEvent(e); // in a design a missing target is not a fault: neutral, no cross; a blocked call (gap: true) is amber (#85)
      return g(blk ? 'broken blocked' : 'broken', ...(blk ? [...blockedBand(y0, width, BLOCKED_LINE.unresolved), ...blockedLines(e, x1 + 14, y0 + 3, width).slice(1)] : []), arrow(x1, x2, y0, { dashed: true, label: lab(e.label), color: blk ? 'var(--inc)' : gap ? 'var(--ink-2)' : 'var(--t-broken)', cross: !gap && !blk }), e.chip ? rpcChip(e.chip, (x1 + x2) / 2, y0, 'var(--t-broken)', true) : arrowMarkSvg(null, e.msg, x1, x2, y0, false, th, mk()), hit(x1, x2), s('title', {}, e.msg.label));
    }
    if (e.type === 'hop') { // one arrow through the topic: its colour changes exactly on the topic lifeline; the event type reads like a REST path
      const x1 = edge(e.fromBar, e.from, 1), x2 = colX.get(e.to), tx = e.via ? colX.get(e.via) : e.fork ? colX.get(e.from) : null, mc = colorOf(e.transport), tc = colorOf(e.trunkTransport), hl = e.sub ? [e.label, e.sub] : e.label;
      let kids, left = x1, mid;
      if (e.via) { kids = [arrow(x1, tx, y0, { label: lab(hl), color: tc, bare: true }), arrow(tx, x2, y0, { color: mc }), s('circle', { class: 'via', cx: tx, cy: y0, r: 3.2, style: `--mc:${mc}` })]; mid = (tx + x2) / 2; }
      else if (e.fork) { // a branch: leaves the topic lifeline downwards from the arrow above it and turns right
        left = tx; mid = (tx + 6 + x2) / 2;
        kids = [s('path', { class: 'fork', d: `M${tx} ${ys[r - 1]}V${y0 - 7}Q${tx} ${y0} ${tx + 7} ${y0}`, style: `--mc:${mc}` }), arrow(tx + 6, x2, y0, { color: mc })];
      } else { kids = [arrow(x1, x2, y0, { label: e.trunk ? lab(hl) : null, color: mc })]; mid = (x1 + x2) / 2; }
      return g('hop', ...kids, e.marker ? marker(e.marker, mid, y0, mc) : null, e.end ? stop(e.end, x2, 1, y0, mc, r) : null, ...(e.publish ? [trunkHit(x1, tx, y0, e), hit(tx, x2)] : [hit(left, x2)]), s('title', {}, [e.msg.label, e.marker?.full].filter(Boolean).join('\n')));
    }
    if (e.type === 'note') return noteSvg(e, y0, { colX, idx, groups });
    if (e.type === 'decision') return decisionSvg(e, y0, { width, ...decide });
    if (e.type === 'icall' && isBlockedEvent(e)) return blockedIcall(e, g, y0, { barX, width });
    if (e.type === 'icall') { // a call inside the service (0.38.0): a ring on its bar, the name, and a grey "internal" tag; a step like the arrows
      const x0 = barX(e.bar, 1), tx = x0 + 44, name = String(e.label), room = Math.max(8, Math.floor((width - tx - 76) / 7.2)), t = name.length > room ? `${name.slice(0, room - 1)}…` : name;
      return g(`icall${e.msg.gap || e.msg.broken ? ' warn' : ''}`, s('circle', { class: 'idot', cx: x0, cy: y0, r: 3.6 }), s('text', { class: 'ilab', x: tx, y: y0 + 4 }, t), s('rect', { class: 'itag', x: tx + t.length * 7.2 + 8, y: y0 - 7, width: 52, height: 15, rx: 7.5 }), s('text', { class: 'itagt', x: tx + t.length * 7.2 + 34, y: y0 + 4, 'text-anchor': 'middle' }, 'internal'), ...inlineMarks(e.msg, tx + t.length * 7.2 + 66, y0, width - 12, runs?.byMsg.get(e.msg)?.first), s('rect', { class: 'hit', x: x0 - 6, y: y0 - 14, width: Math.max(60, width - x0 - 12), height: 28 }), s('title', {}, `${e.msg.label}\n${e.msg.fn ? `in ${e.msg.service}:${e.msg.fn}` : 'a call inside the service'}`));
    }
    if (e.type === 'amqpnote') { // the bindings that do not route this publish, under the fork; the exchange page lists them
      const x0 = colX.get(e.col) + 10;
      return s('g', { class: 'amqpnote' }, s('text', { x: x0, y: y0 + 4 }, e.text),
        s('a', { href: href(`/instances/${encodeURIComponent('amqp:' + e.exchange)}`), 'aria-label': `Exchange page of ${e.exchange}` }, s('text', { class: 'lnk', x: x0 + e.text.length * 5.6 + 12, y: y0 + 4 }, 'Exchange page'), s('title', {}, `Open the exchange ${e.exchange}`)));
    }
    if (e.type === 'store') { // an arrow to the lifeline of the collection: a read keeps a bar and a dashed return, a write is heavier with a shorter bar and no return (0.27.1)
      const x1 = barX(e.bar, 1), inFold = folded.has(idx.get(e.col)), x2 = inFold ? colX.get(e.col) : colX.get(e.col) - BAR / 2, mc = colorOf('res'), bx = colX.get(e.col) - BAR / 2;
      return g(`store${e.write ? ' write' : ''}`, arrow(x1, x2, y0, { label: lab(e.msg.dbGroup ? `› ${e.label}` : e.label), color: mc }), e.dbOpen ? dbToggle(e.msg.key, Math.min(x1, x2) + 6, y0) : null,
        s('rect', { class: 'sbar', x: bx, y: y0 - 5, width: BAR, height: e.write ? 16 : 28, rx: 2 }),
        e.write ? null : s('g', { class: 'sret' }, arrow(bx, x1, y0 + 17, { dashed: true, open: true, color: mc, bare: false })),
        hit(x1, x2), ...arrowMarkSvg(marks, e.msg, x1, x2, y0, stacked?.has(e), th, mk()), s('title', {}, `${e.msg.label}\n${e.msg.store ?? ''}${e.write ? '\nwrite' : ''}`));
    }
    if (e.type === 'frontier') {
      const x0 = barX(e.bar, 1);
      return frontierSvg(e, r, x0, y0); // #85: a real button, "frontier: N steps" and "· M blocked" in amber
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
    return s('g', { class: `note${gaps ? ' warn' : ''}`, 'data-pill': e.bar.id, 'data-ipill': 1, tabindex: 0, role: 'button' }, s('path', { class: 'tick', d: `M${x0} ${y0} h12` }),
      s('rect', { x: x0 + 12, y: y0 - 11, width: text.length * 6.4 + 16, height: 22, rx: 11 }), s('text', { x: x0 + 20, y: y0 + 4 }, text), s('title', {}, 'Calls inside this service are folded. Click to show them.'));
  });
}
