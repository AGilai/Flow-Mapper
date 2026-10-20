// Draws a lane (flow-lane.js) as SVG: a sticky header of lifeline cards and a body with activation bars, arrows,
// stubs, the "published events" rail and alt frames. No layout rules live here beyond row heights.
//
//   solid arrow, filled head   = call            dashed, open head = return
//   red dashed with a cross    = call that matches nothing
//   bar colour / arrow colour  = transport that entered the service

import { h, s } from '../dom.js';
import { altFrames, stripsByRow, drawFrames, STRIP } from './sequence-alt.js';

const COL = 168, HEAD = 56, PAD = 24, GUTTER = 8, BAR = 12, NEST = 8;
const ROWH = { call: 46, return: 36, pill: 32, store: 46, publish: 66, unresolved: 42, frontier: 32 };
const LINE = { call: 30, return: 22, pill: 16, store: 23, publish: 30, unresolved: 28, frontier: 16 };
const T_VAR = { http: '--t-http', rpc: '--t-rpc', grpc: '--t-http', eventbridge: '--t-eb', sns: '--t-sns', sqs: '--t-sqs', amqp: '--t-amqp', cron: '--t-cron', res: '--t-res' };
const colorOf = (t) => `var(${T_VAR[t] ?? '--ink-2'})`;
const clip = (t, n) => (t.length > n ? t.slice(0, Math.max(1, n - 1)) + '…' : t);

/**
 * renderLane(lane, handlers) -> { el, body, events, bars }
 * handlers: onMessage(msg, g, event), onBar(bar, 'select'?) (double-click, pill: look inside; click: select),
 * onBarMenu(bar, x, y), onParticipant(p, x, y), onBadge(publishEvent). `selected`: bar id drawn highlighted.
 */
export function renderLane(lane, { onMessage, onBar, onBarMenu, onParticipant, onBadge, selected = null, sticky = true } = {}) {
  const { columns, events, bars } = lane;
  const colX = new Map(columns.map((c, i) => [c, PAD + GUTTER + i * COL + COL / 2]));
  const width = PAD * 2 + GUTTER + columns.length * COL + (columns.some((c) => c.kind === 'rail') ? 110 : 200);
  const frames = altFrames(lane.altMsgs), strips = stripsByRow(frames, lane.altRows);
  const nStrips = (r) => strips.get(r)?.length ?? 0;
  const top = [], ys = [];
  let y = PAD;
  events.forEach((e, r) => { top[r] = y; ys[r] = y + nStrips(r) * STRIP + LINE[e.type]; y += nStrips(r) * STRIP + ROWH[e.type]; });
  top[events.length] = y;
  const height = y + PAD;
  const barX = (bar, dir) => colX.get(bar.col) + bar.level * NEST + dir * BAR / 2;
  const edge = (bar, col, dir) => (bar ? barX(bar, dir) : colX.get(col));

  const head = s('svg', { width, height: HEAD, class: 'seq-head', role: 'presentation' }, columns.map((c, i) =>
    s('g', { class: `seq-part k-${c.kind}`, 'data-p': i, transform: `translate(${colX.get(c) - COL / 2 + 8},8)` },
      s('rect', { width: COL - 16, height: HEAD - 16, rx: 8 }), c.kind === 'rail' ? null : s('rect', { class: 'stripe', width: 4, height: HEAD - 16, rx: 2 }),
      s('text', { x: 12, y: 18, class: 'name' }, clip(c.label, 21)), s('text', { x: 12, y: 33, class: 'sub' }, clip(c.sub ?? '', 25)), s('title', {}, c.label))));

  const arrowHead = (x, dir, open) => s('path', { d: open ? `M${x - dir * 7} -4L${x} 0L${x - dir * 7} 4` : `M${x - dir * 8} -4L${x} 0L${x - dir * 8} 4z`, class: open ? 'head open' : 'head' });
  const arrow = (x1, x2, y0, { dashed, open, label, italic, color, cross } = {}) => {
    const dir = Math.sign(x2 - x1) || 1;
    return s('g', { class: 'arr', style: `--mc:${color}` },
      s('line', { class: 'arrow', x1, x2: x2 - dir * 2, y1: y0, y2: y0, 'stroke-dasharray': dashed ? '5 4' : null }),
      s('g', { transform: `translate(0 ${y0})` }, arrowHead(x2, dir, open)),
      label ? s('text', { class: `label${italic ? ' ret' : ''}`, x: (x1 + x2) / 2, y: y0 - 6, 'text-anchor': 'middle' }, clip(label, Math.floor((Math.abs(x2 - x1) - 16) / 7.2))) : null,
      cross ? s('path', { d: `M${x2 - 5} ${y0 - 5}l10 10M${x2 + 5} ${y0 - 5}l-10 10`, class: 'x' }) : null);
  };

  const drawn = events.map((e, r) => {
    const y0 = ys[r];
    const g = (cls, ...kids) => s('g', { class: `msg ${cls}`, 'data-e': r, tabindex: e.msg ? 0 : null, role: e.msg ? 'button' : null }, ...kids);
    const hit = (x1, x2) => s('rect', { class: 'hit', x: Math.min(x1, x2) - 4, y: y0 - 22, width: Math.abs(x2 - x1) + 8, height: 30 });
    const owner = e.fromBar ?? e.bar;
    if (e.type === 'call') {
      const dir = Math.sign(colX.get(e.to) - colX.get(e.from)) || 1;
      const x1 = edge(e.fromBar, e.from, dir), x2 = e.bar ? barX(e.bar, -dir) : colX.get(e.to);
      return g('', arrow(x1, x2, y0, { label: e.label, color: colorOf(e.msg.transport), dashed: e.msg.mode === 'async' && !e.bar }), hit(x1, x2), s('title', {}, e.msg.label));
    }
    if (e.type === 'return') {
      const dir = Math.sign(colX.get(e.to) - colX.get(e.bar.col)) || 1;
      const x1 = barX(e.bar, dir), x2 = e.bar.parent ? barX(e.bar.parent, -dir) : colX.get(e.to);
      return s('g', { class: 'msg ret-msg' }, arrow(x1, x2, y0, { dashed: true, open: true, italic: true, label: e.label, color: colorOf(e.bar.transport) }));
    }
    if (e.type === 'unresolved') {
      const x1 = barX(owner, 1), x2 = colX.get(e.col) - 8;
      return g('broken', arrow(x1, x2, y0, { dashed: true, label: e.label, color: 'var(--t-broken)', cross: true }), hit(x1, x2), s('title', {}, e.msg.label));
    }
    if (e.type === 'publish') {
      const x1 = barX(owner, 1), x2 = colX.get(e.col) - 2, cx = x2 + 10, w = Math.max(60, e.topic.length * 6.6 + 14), none = !e.flows;
      const bw = none ? 92 : 56 + String(e.flows).length * 7;
      return g('publish', arrow(x1, x2, y0, { label: e.label, color: colorOf(e.msg.transport) }), hit(x1, x2),
        s('g', { class: 'chipg', style: `--mc:${colorOf(e.msg.transport)}` }, s('rect', { class: 'chip', x: cx, y: y0 - 10, width: w, height: 20, rx: 4 }), s('text', { class: 'chipt', x: cx + 7, y: y0 + 4 }, e.topic)),
        s('g', { class: `badge ${none ? 'warn' : 'async'}`, 'data-badge': r, tabindex: none ? null : 0, role: none ? null : 'link' },
          s('rect', { x: cx, y: y0 + 14, width: bw, height: 18, rx: 9 }), s('text', { x: cx + 8, y: y0 + 27 }, none ? 'no consumers' : `↓ ${e.flows} ${e.flows === 1 ? 'flow' : 'flows'}`)), s('title', {}, e.msg.label));
    }
    if (e.type === 'store') {
      const x0 = barX(e.bar, 1), w = Math.max(e.verb.length * 7, e.name.length * 6) + 18;
      return g('store', s('line', { class: 'stub', x1: x0, x2: x0 + 14, y1: y0, y2: y0 }), s('rect', { class: 'spill', x: x0 + 14, y: y0 - 16, width: w, height: 32, rx: 6 }),
        s('text', { class: 'p1', x: x0 + 23, y: y0 - 2 }, clip(e.verb, 30)), s('text', { class: 'p2', x: x0 + 23, y: y0 + 11 }, clip(e.name, 34)), s('title', {}, `${e.msg.label}\n${e.msg.store ?? ''}`));
    }
    if (e.type === 'frontier') {
      const x0 = barX(e.bar, 1);
      return g('frontier', s('path', { class: 'stub', d: `M${x0} ${y0} h10` }), s('text', { class: 'label', x: x0 + 16, y: y0 + 4 }, `${e.msg.label}  (click to show)`));
    }
    const n = e.bar.internal.n, gaps = e.bar.internal.gaps, x0 = barX(e.bar, 1);
    const text = `${n} internal ${n === 1 ? 'call' : 'calls'}${gaps ? ` · ${gaps} unresolved` : ''} ▸`;
    return s('g', { class: `note${gaps ? ' warn' : ''}`, 'data-pill': e.bar.id, tabindex: 0, role: 'button' }, s('path', { class: 'tick', d: `M${x0} ${y0} h12` }),
      s('rect', { x: x0 + 12, y: y0 - 11, width: text.length * 6.4 + 16, height: 22, rx: 11 }), s('text', { x: x0 + 20, y: y0 + 4 }, text), s('title', {}, 'Calls inside this service are folded. Click to see them.'));
  });

  const rects = bars.map((b) => {
    const y1 = ys[b.start] - 16, y2 = ys[b.end] + 14;
    const r = s('rect', { class: `act${selected === b.id ? ' selected' : ''}`, 'data-bar': b.id, x: barX(b, -1), y: y1, width: BAR, height: Math.max(20, y2 - y1), rx: 3, style: `--mc:${colorOf(b.transport)}`, tabindex: 0, role: 'button',
      'aria-label': `${b.service}: ${b.msg.label}. Press Enter to look inside` }, s('title', {}, `${b.service}\n${b.msg.label}\nDouble-click to look inside`));
    b.el = r;
    return r;
  });
  const body = s('svg', { width, height, class: 'seq-body', role: 'img', 'aria-label': `Flow with ${bars.length} calls across ${columns.length} lifelines` },
    drawFrames(frames, lane.altRows, strips, (r) => top[r], (r) => top[r + 1], width, GUTTER),
    columns.map((c) => s('line', { class: c.kind === 'rail' ? 'rail' : 'lifeline', x1: colX.get(c), x2: colX.get(c), y1: 0, y2: height })), rects, drawn);

  const eventOf = (t) => events[Number(t.closest?.('[data-e]')?.dataset.e)];
  const barOf = (t) => { const r = t.closest?.('[data-bar]'); return r ? bars[Number(r.dataset.bar)] : null; };
  const badgeOf = (t) => { const b = t.closest?.('[data-badge]'); return b ? events[Number(b.dataset.badge)] : null; };
  const pillOf = (t) => { const b = t.closest?.('[data-pill]'); return b ? bars[Number(b.dataset.pill)] : null; };
  const pm = (ev) => {
    const g = ev.target.closest?.('[data-p]'), c = g && columns[Number(g.dataset.p)];
    if (c?.service && onParticipant) { ev.preventDefault(); onParticipant({ id: `svc:${c.service}`, kind: 'service', service: c.service, label: c.label }, ev.clientX, ev.clientY); }
  };
  head.addEventListener('contextmenu', pm);
  head.addEventListener('click', pm);
  body.addEventListener('dblclick', (ev) => { const b = barOf(ev.target); if (b) onBar?.(b); });
  body.addEventListener('contextmenu', (ev) => { const b = barOf(ev.target); if (b) { ev.preventDefault(); onBarMenu?.(b, ev.clientX, ev.clientY); } });
  body.addEventListener('click', (ev) => {
    const bd = badgeOf(ev.target), pill = pillOf(ev.target), b = barOf(ev.target), e = eventOf(ev.target);
    if (bd) { ev.stopPropagation(); onBadge?.(bd); } else if (pill) onBar?.(pill); else if (b) onBar?.(b, 'select'); else if (e?.msg) onMessage?.(e.msg, ev.target.closest('[data-e]'), e);
  });
  body.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    const bd = badgeOf(ev.target), pill = pillOf(ev.target), b = barOf(ev.target), e = eventOf(ev.target);
    if (bd) onBadge?.(bd); else if (pill) onBar?.(pill); else if (b) onBar?.(b); else if (e?.msg) onMessage?.(e.msg, ev.target.closest('[data-e]'), e);
  });
  body.__events = events;
  return { el: h('div.seq', h(sticky ? 'div.seq-sticky' : 'div.seq-head-static', head), body), body, events, bars };
}
