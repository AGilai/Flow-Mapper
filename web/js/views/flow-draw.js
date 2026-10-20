// Draws a lane (flow-lane.js) as SVG: a sticky header of lifeline cards and a body with activation bars, arrows,
// stubs, the "published events" rail and alt frames. No layout rules live here beyond row heights.
//
//   solid arrow, filled head   = call            dashed, open head = return
//   red dashed with a cross    = call that matches nothing
//   bar colour / arrow colour  = transport that entered the service

import { h, s } from '../dom.js';
import { altFrames, stripsByRow, drawFrames, STRIP } from './sequence-alt.js';
import { mwLabel, isLongChain } from './flow-mw.js';
import { arrowEnds, columnGaps, centres, labelWidth, wrapId } from './flow-cols.js';

const COL = 138, COL_MIN = 96, PAD = 16, GUTTER = 8, BAR = 12, NEST = 8;
const ROWH = { call: 46, return: 36, pill: 32, mw: 34, store: 46, publish: 66, unresolved: 42, frontier: 32 };
const LINE = { call: 30, return: 22, pill: 16, mw: 17, store: 23, publish: 30, unresolved: 28, frontier: 16 };
const T_VAR = { http: '--t-http', rpc: '--t-rpc', grpc: '--t-http', eventbridge: '--t-eb', sns: '--t-sns', sqs: '--t-sqs', amqp: '--t-amqp', cron: '--t-cron', res: '--t-res' };
const colorOf = (t) => `var(${T_VAR[t] ?? '--ink-2'})`;
const SUB_CH = 19, CHIP_PX = 7, LINE_H = 14;

/**
 * renderLane(lane, handlers) -> { el, body, events, bars }
 * handlers: onMessage(msg, g, event), onBar(bar, 'select'?) (double-click, pill: look inside; click: select),
 * onBarMenu(bar, x, y), onParticipant(p, x, y), onBadge(publishEvent). `selected`: bar id drawn highlighted.
 */
export function renderLane(lane, { onMessage, onBar, onBarMenu, onParticipant, onBadge, onMw, onBarTip, selected = null, sticky = true, fit = 0 } = {}) {
  const { columns, events, bars } = lane;
  // Each gap between lifelines grows to fit the longest arrow label that crosses it: a label is never cut.
  const idx = new Map(columns.map((c, i) => [c, i]));
  const chipW = (e) => e.topic.length * CHIP_PX + 18;
  // A publish arrow is short: its event name sits over the topic chip, both centred on the rail, so the rail needs only half of the wider one on each side.
  const pubW = (e) => Math.max(60, chipW(e), labelWidth(e.label));
  const chipMax = Math.max(60, ...events.filter((e) => e.type === 'publish').map(pubW));
  const spans = events.flatMap((e) => { const ends = arrowEnds(e); return ends ? [{ a: idx.get(ends[0]), b: idx.get(ends[1]), need: e.type === 'publish' ? pubW(e) / 2 + BAR + 2 * NEST + 24 : labelWidth(e.label) + 8 + BAR + 2 * NEST }] : []; });
  const rIdx = columns.findIndex((c) => c.kind === 'rail');
  if (rIdx >= 0 && rIdx < columns.length - 1) spans.push({ a: rIdx, b: rIdx + 1, need: chipMax / 2 + 40 }); // the unresolved column must clear the topic chips (they sit on the rail)
  // `fit`: the room the diagram has. The plain gap shrinks (to COL_MIN) until the rail and its chips show without scrolling.
  const layout = (col) => {
    const xs = centres(PAD + GUTTER + col / 2, columnGaps(columns.length, spans, col));
    const railX = rIdx >= 0 ? xs[rIdx] : null;
    const chipRight = railX == null ? 0 : railX + chipMax / 2;
    const reach = railX == null ? xs[xs.length - 1] + col / 2 + 200 - col / 2 : Math.max(xs[xs.length - 1] + col / 2, chipRight);
    return { xs, col, width: Math.ceil(reach + PAD), railEnd: railX == null ? 0 : chipRight + PAD };
  };
  let L = layout(COL);
  for (let col = COL - 6; fit && L.railEnd > fit && col >= COL_MIN; col -= 6) L = layout(col);
  const { xs, col: COLW, width } = L, HEAD_BOX = COLW - 8, nameCh = Math.max(9, Math.floor((HEAD_BOX - 18) / 6.9));
  const colX = new Map(columns.map((c, i) => [c, xs[i]]));
  // a queue head drops its transport prefix and the 'queue delivery' line (the title keeps both): two lines at most
  const heads = columns.map((c) => (c.sub === 'queue delivery' ? { name: wrapId(c.label.replace(/^[^:]+:/, ''), nameCh), sub: [] } : { name: wrapId(c.label, nameCh), sub: wrapId(c.sub ?? '', SUB_CH) }));
  const boxH = 12 + Math.max(...heads.map((x) => x.name.length * LINE_H + x.sub.length * 13)) + 6, HEAD = boxH + 16;
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
    s('g', { class: `seq-part k-${c.kind}`, 'data-p': i, transform: `translate(${colX.get(c) - HEAD_BOX / 2},8)` },
      s('rect', { width: HEAD_BOX, height: boxH, rx: 8 }), c.kind === 'rail' ? null : s('rect', { class: 'stripe', width: 4, height: boxH, rx: 2 }),
      heads[i].name.map((t, k) => s('text', { x: 12, y: 18 + k * LINE_H, class: 'name' }, t)),
      heads[i].sub.map((t, k) => s('text', { x: 12, y: 18 + heads[i].name.length * LINE_H + 1 + k * 13, class: 'sub' }, t)), s('title', {}, c.label))));

  const arrowHead = (x, dir, open) => s('path', { d: open ? `M${x - dir * 7} -4L${x} 0L${x - dir * 7} 4` : `M${x - dir * 8} -4L${x} 0L${x - dir * 8} 4z`, class: open ? 'head open' : 'head' });
  const arrow = (x1, x2, y0, { dashed, open, label, italic, color, cross } = {}) => {
    const dir = Math.sign(x2 - x1) || 1;
    return s('g', { class: 'arr', style: `--mc:${color}` },
      s('line', { class: 'arrow', x1, x2: x2 - dir * 2, y1: y0, y2: y0, 'stroke-dasharray': dashed ? '5 4' : null }),
      s('g', { transform: `translate(0 ${y0})` }, arrowHead(x2, dir, open)),
      label ? s('text', { class: `label${italic ? ' ret' : ''}`, x: (x1 + x2) / 2, y: y0 - 6, 'text-anchor': 'middle' }, label) : null,
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
      const w = Math.max(60, chipW(e)), cx = colX.get(e.col) - w / 2, x1 = barX(owner, 1), x2 = cx - 2, none = !e.flows;
      const bw = none ? 92 : 56 + String(e.flows).length * 7, bx = colX.get(e.col) - bw / 2;
      return g('publish', arrow(x1, x2, y0, { color: colorOf(e.msg.transport) }), s('text', { class: 'label', x: colX.get(e.col), y: y0 - 16, 'text-anchor': 'middle' }, e.label), hit(Math.min(x1, colX.get(e.col) - pubW(e) / 2), colX.get(e.col) + pubW(e) / 2),
        s('g', { class: 'chipg', style: `--mc:${colorOf(e.msg.transport)}` }, s('rect', { class: 'chip', x: cx, y: y0 - 10, width: w, height: 20, rx: 4 }), s('text', { class: 'chipt', x: cx + 7, y: y0 + 4 }, e.topic)),
        s('g', { class: `badge ${none ? 'warn' : 'async'}`, 'data-badge': r, tabindex: none ? null : 0, role: none ? null : 'link' },
          s('rect', { x: bx, y: y0 + 14, width: bw, height: 18, rx: 9 }), s('text', { x: bx + 8, y: y0 + 27 }, none ? 'no consumers' : `↓ ${e.flows} ${e.flows === 1 ? 'flow' : 'flows'}`)), s('title', {}, e.msg.label));
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

  const rects = bars.map((b) => {
    const y1 = ys[b.start] - 16, y2 = ys[b.end] + 14;
    const r = s('rect', { class: `act${selected === b.id ? ' selected' : ''}`, 'data-bar': b.id, x: barX(b, -1), y: y1, width: BAR, height: Math.max(20, y2 - y1), rx: 3, style: `--mc:${colorOf(b.transport)}`, tabindex: 0, role: 'button',
      'aria-label': `${b.service}: ${b.msg.label}. Press Enter to look inside` }, onBarTip ? null : s('title', {}, `${b.service}\n${b.msg.label}\nDouble-click to look inside`)); // onBarTip draws the popover instead
    b.el = r;
    return r;
  });
  const segs = bars.flatMap((b) => (b.mw?.spans ?? []).map((sp, k) => { // middleware segments: on top of the bar, from the bar's top down
    const y1 = k === 0 ? ys[b.start] - 16 : ys[sp.from] - 16, y2 = k + 1 < b.mw.spans.length ? ys[b.mw.spans[k + 1].from] - 16 : ys[sp.to] + 14, seg = b.mw.segs[k], fold = isLongChain(b.mw.chain);
    return s('rect', { class: `mwseg${selected === b.id ? ' selected' : ''}`, 'data-bar': b.id, 'data-mwfold': fold ? b.id : null, x: barX(b, -1), y: y1, width: BAR, height: Math.max(16, y2 - y1), rx: 3, tabindex: 0, role: 'button',
      'aria-label': `Middleware ${seg.label} in ${b.service}` }, s('title', {}, fold ? 'Click to expand or collapse the middleware chain' : `middleware: ${seg.label}\n${b.service}`));
  }));
  const body = s('svg', { width, height, class: 'seq-body', role: 'group', 'aria-label': `Flow with ${bars.length} calls across ${columns.length} lifelines` },
    s('defs', {}, s('pattern', { id: 'mwh', width: 6, height: 6, patternUnits: 'userSpaceOnUse', patternTransform: 'rotate(45)' }, s('rect', { width: 6, height: 6, fill: 'var(--mw-bg)' }), s('rect', { width: 2.4, height: 6, fill: 'var(--mw)' }))),
    drawFrames(frames, lane.altRows, strips, (r) => top[r], (r) => top[r + 1], width, GUTTER),
    columns.map((c) => s('line', { class: c.kind === 'rail' ? 'rail' : 'lifeline', x1: colX.get(c), x2: colX.get(c), y1: 0, y2: height })), rects, segs, drawn);

  const eventOf = (t) => events[Number(t.closest?.('[data-e]')?.dataset.e)];
  const barOf = (t) => { const r = t?.closest?.('[data-bar]'); return r ? bars[Number(r.dataset.bar)] : null; };
  const badgeOf = (t) => { const b = t.closest?.('[data-badge]'); return b ? events[Number(b.dataset.badge)] : null; };
  const foldOf = (t) => t.closest?.('[data-mwfold]');
  const fold = (el) => onMw?.(bars[Number(el.dataset.mwfold)], el.classList.contains('mwlab') ? '.mwlab' : '.mwseg'); // the redraw replaces the element: the caller refocuses by this selector
  const pillOf = (t) => { const b = t.closest?.('[data-pill]'); return b ? bars[Number(b.dataset.pill)] : null; };
  const pm = (ev) => {
    const g = ev.target.closest?.('[data-p]'), c = g && columns[Number(g.dataset.p)];
    if (c?.service && onParticipant) { ev.preventDefault(); onParticipant({ id: `svc:${c.service}`, kind: 'service', service: c.service, label: c.label }, ev.clientX, ev.clientY); }
  };
  head.addEventListener('contextmenu', pm);
  head.addEventListener('click', pm);
  let foldTimer = 0; // a fold click waits a beat so a double-click (look inside) never flips the fold
  body.addEventListener('dblclick', (ev) => { clearTimeout(foldTimer); const f = foldOf(ev.target), b = barOf(ev.target) ?? (f ? bars[Number(f.dataset.mwfold)] : null); if (b) onBar?.(b); });
  if (onBarTip) { // the popover on a bar: hover (the caller delays it) and keyboard focus
    const enter = (ev) => { const b = barOf(ev.target); if (b && barOf(ev.relatedTarget) !== b) onBarTip(b, b.el); };
    const leave = (ev) => { const b = barOf(ev.target); if (b && barOf(ev.relatedTarget) !== b) onBarTip(null); };
    body.addEventListener('mouseover', enter); body.addEventListener('mouseout', leave);
    body.addEventListener('focusin', enter); body.addEventListener('focusout', leave);
    body.addEventListener('dblclick', () => onBarTip(null)); body.addEventListener('contextmenu', () => onBarTip(null));
  }
  body.addEventListener('contextmenu', (ev) => { const b = barOf(ev.target); if (b) { ev.preventDefault(); onBarMenu?.(b, ev.clientX, ev.clientY); } });
  body.addEventListener('click', (ev) => {
    const bd = badgeOf(ev.target), pill = pillOf(ev.target), b = barOf(ev.target), e = eventOf(ev.target);
    if (foldOf(ev.target)) { if (ev.detail <= 1) { const f = foldOf(ev.target); clearTimeout(foldTimer); foldTimer = setTimeout(() => fold(f), 200); } } else if (bd) { ev.stopPropagation(); onBadge?.(bd); } else if (pill) onBar?.(pill); else if (b) onBar?.(b, 'select'); else if (e?.msg) onMessage?.(e.msg, ev.target.closest('[data-e]'), e);
  });
  body.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    const bd = badgeOf(ev.target), pill = pillOf(ev.target), b = barOf(ev.target), e = eventOf(ev.target);
    if (foldOf(ev.target)) fold(foldOf(ev.target)); else if (bd) onBadge?.(bd); else if (pill) onBar?.(pill); else if (b) onBar?.(b); else if (e?.msg) onMessage?.(e.msg, ev.target.closest('[data-e]'), e);
  });
  body.__events = events;
  return { el: h('div.seq', h(sticky ? 'div.seq-sticky' : 'div.seq-head-static', head), body), body, events, bars };
}
