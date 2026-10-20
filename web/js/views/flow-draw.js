// Draws a lane (flow-lane.js) as SVG: a sticky header of lifeline cards and a body with activation bars, arrows,
// stubs, the topic and queue lifelines of publish chains and alt frames. No layout rules live here beyond row heights.
//
//   solid arrow, filled head   = call or routing hop     dashed, open head = return
//   red dashed with a cross    = call that matches nothing
//   bar colour / arrow colour  = transport that entered the service / the hop's transport
//   stop bar + number tiles    = a publish chain ends at a queue: the tiles are the async flows that start there (rows of the list below)

import { h, s } from '../dom.js';
import { altFrames, stripsByRow, drawFrames, STRIP } from './sequence-alt.js';
import { mwLabel, isLongChain } from './flow-mw.js';
import { arrowEnds, columnGaps, centres, labelWidth, wrapId, clampLines } from './flow-cols.js';
import { chName } from './flow-chain.js';

const COL = 138, COL_MIN = 132, PAD = 16, GUTTER = 8, BAR = 12, NEST = 8, CH_HEAD = 116; // CH_HEAD: a topic or queue head is narrower than a service head
const ROWH = { call: 46, return: 36, pill: 32, mw: 34, store: 46, hop: 48, unresolved: 42, frontier: 32 };
const rowH = (e) => (e.type === 'hop' && e.marker ? 56 : ROWH[e.type]);
const LINE = { call: 30, return: 22, pill: 16, mw: 17, store: 23, hop: 30, unresolved: 28, frontier: 16 };
const T_VAR = { http: '--t-http', rpc: '--t-rpc', grpc: '--t-http', eventbridge: '--t-eb', sns: '--t-sns', sqs: '--t-sqs', amqp: '--t-amqp', cron: '--t-cron', socket: '--t-socket', res: '--t-res' };
const colorOf = (t) => `var(${T_VAR[t] ?? '--ink-2'})`;
const SUB_CH = 19, LINE_H = 14, TILE_PX = 6.6;
const tileW = (t) => Math.max(22, Math.ceil(String(t).length * TILE_PX) + 12);
const markW = (m) => Math.ceil(m.label.length * 6.4) + 30;
const FUNNEL = 'M1.5 2h9L7 6.3V10l-2-1V6.3z';

/**
 * renderLane(lane, handlers) -> { el, body, events, bars }
 * handlers: onMessage(msg, g, event), onBar(bar, 'select'?) (double-click, pill: look inside; click: select),
 * onBarMenu(bar, x, y), onParticipant(p, x, y), onNum(jump) (a number tile at a queue), onNumHover(own labels, on), onFan(topic) (fold or unfold a big fan-out).
 * `selected`: bar id drawn highlighted. Returns { el, body, events, bars, mark(label, on) } (mark: highlight the tiles of a list row).
 */
export function renderLane(lane, { onMessage, onBar, onBarMenu, onParticipant, onNum, onNumHover, onFan, onMw, onBarTip, selected = null, sticky = true, fit = 0 } = {}) {
  const { columns, events, bars } = lane;
  // Each gap between lifelines grows to fit the longest arrow label that crosses it: a label is never cut.
  const idx = new Map(columns.map((c, i) => [c, i]));
  const isCh = (c) => c.kind === 'channel', headW = (c, col) => (isCh(c) ? CH_HEAD : col - 8);
  // The room right of a queue for its number tiles (or "no reader"): the next lifeline in that direction must clear it.
  const endW = (e) => (e.end ? (e.end.none ? e.end.none.length * 8 + 36 : e.end.tiles.reduce((n, t) => n + tileW(t.text) + 4, 0)) + 14 : 0);
  // A publish is one arrow: the event type sits on its first part (service -> topic), the filter marker on the second (topic -> queue). Branch rows carry the marker only.
  const hopSpans = (e) => {
    const a = idx.get(e.from), b = idx.get(e.to), v = e.via ? idx.get(e.via) : null, lab = e.trunk ? labelWidth(e.label) + 8 + BAR + 2 * NEST : 0, mk = e.marker ? markW(e.marker) + 16 : 0;
    return v == null ? [{ a, b, need: Math.max(lab, mk) }] : [{ a, b: v, need: lab }, { a: v, b, need: mk }];
  };
  const spans = events.flatMap((e) => {
    const ends = e.type === 'hop' ? [e.from, e.to] : arrowEnds(e);
    if (!ends) return [];
    const a = idx.get(ends[0]), b = idx.get(ends[1]), out = e.type === 'hop' ? hopSpans(e) : [{ a, b, need: labelWidth(e.label) + 8 + BAR + 2 * NEST }];
    if (e.end) { const n = b + (Math.sign(b - a) || 1); if (n >= 0 && n < columns.length) out.push({ a: b, b: n, need: endW(e) + 14 }); }
    return out;
  });
  // `fit`: the room the diagram has. The plain gap shrinks (to COL_MIN) until everything shows without scrolling; topic and queue gaps stay.
  const layout = (col) => {
    const xs = centres(PAD + GUTTER + col / 2, columnGaps(columns.length, spans, (i) => Math.round((headW(columns[i], col) + headW(columns[i + 1], col)) / 2 + 8)));
    const last = columns[columns.length - 1];
    const reach = xs[xs.length - 1] + (isCh(last) ? 92 : 200);
    return { xs, col, width: Math.ceil(reach + PAD) };
  };
  let L = layout(COL);
  for (let col = COL - 6; fit && L.width > fit && col >= COL_MIN; col -= 6) L = layout(col);
  const { xs, col: COLW, width } = L, HEAD_BOX = COLW - 8, nameCh = (c) => Math.max(9, Math.floor((headW(c, COLW) - 14) / 6.6));
  const colX = new Map(columns.map((c, i) => [c, xs[i]]));
  // a queue head drops its transport prefix and the 'queue delivery' line (the title keeps both): two lines at most
  const heads = columns.map((c) => (c.sub === 'queue delivery' ? { name: clampLines(wrapId(c.label.replace(/^[^:]+:/, ''), nameCh(c)), nameCh(c)), sub: [] } : { name: clampLines(wrapId(c.label, nameCh(c)), nameCh(c)), sub: isCh(c) ? [c.sub] : wrapId(c.sub ?? '', SUB_CH) }));
  const boxH = 12 + Math.max(...heads.map((x) => x.name.length * LINE_H + x.sub.length * 13)) + 6, HEAD = boxH + 16;
  const frames = altFrames(lane.altMsgs), strips = stripsByRow(frames, lane.altRows);
  const nStrips = (r) => strips.get(r)?.length ?? 0;
  const top = [], ys = [];
  let y = PAD;
  events.forEach((e, r) => { top[r] = y; ys[r] = y + nStrips(r) * STRIP + LINE[e.type]; y += nStrips(r) * STRIP + rowH(e); });
  top[events.length] = y;
  const height = y + PAD;
  const barX = (bar, dir) => colX.get(bar.col) + bar.level * NEST + dir * BAR / 2;
  const edge = (bar, col, dir) => (bar ? barX(bar, dir) : colX.get(col));

  const headBox = (c) => headW(c, COLW);
  const head = s('svg', { width, height: HEAD, class: 'seq-head', role: 'presentation' }, columns.map((c, i) =>
    s('g', { class: `seq-part k-${c.kind}${c.fan ? ' fan' : ''}`, 'data-p': i, style: isCh(c) ? `--mc:${colorOf(c.transport)}` : null, transform: `translate(${colX.get(c) - headBox(c) / 2},8)`, tabindex: c.fan ? 0 : null, role: c.fan ? 'button' : null },
      s('rect', { width: headBox(c), height: boxH, rx: 8 }), s('rect', { class: 'stripe', width: 4, height: boxH, rx: 2 }),
      heads[i].name.map((t, k) => s('text', { x: 12, y: 18 + k * LINE_H, class: 'name' }, t)),
      isCh(c) ? headChip(c, heads[i].name.length * LINE_H + 5) : heads[i].sub.map((t, k) => s('text', { x: 12, y: 18 + heads[i].name.length * LINE_H + 1 + k * 13, class: 'sub' }, t)),
      s('title', {}, c.folded ? `${c.folded.length} more queues: ${c.folded.map(chName).join(', ')}. Click to show them all.` : c.fan?.open ? `${c.label}. Click to fold the healthy queues again.` : c.label))));
  function headChip(c, y) { // the transport of a topic or queue, as a chip; a big fan-out adds its fold control
    const w = c.sub.length * 6.4 + 12;
    return [s('rect', { class: 'tchip', x: 12, y: y + 4, width: w, height: 16, rx: 4 }), s('text', { class: 'tchipt', x: 18, y: y + 16 }, c.sub),
      c.fan ? s('text', { class: 'fanbtn', x: 12 + w + 6, y: y + 16 }, c.folded ? 'show ▸' : 'fold ▴') : null];
  }

  const arrowHead = (x, dir, open) => s('path', { d: open ? `M${x - dir * 7} -4L${x} 0L${x - dir * 7} 4` : `M${x - dir * 8} -4L${x} 0L${x - dir * 8} 4z`, class: open ? 'head open' : 'head' });
  const arrow = (x1, x2, y0, { dashed, open, label, italic, color, cross, bare } = {}) => {
    const dir = Math.sign(x2 - x1) || 1;
    return s('g', { class: 'arr', style: `--mc:${color}` },
      s('line', { class: 'arrow', x1, x2: bare ? x2 : x2 - dir * 2, y1: y0, y2: y0, 'stroke-dasharray': dashed ? '5 4' : null }),
      bare ? null : s('g', { transform: `translate(0 ${y0})` }, arrowHead(x2, dir, open)),
      label ? s('text', { class: `label${italic ? ' ret' : ''}`, x: (x1 + x2) / 2, y: y0 - 6, 'text-anchor': 'middle' }, label) : null,
      cross ? s('path', { d: `M${x2 - 5} ${y0 - 5}l10 10M${x2 + 5} ${y0 - 5}l-10 10`, class: 'x' }) : null);
  };

  // A filter on a hop: a funnel (types, rule, key), a crossed funnel (all but N) or a stack of queues (folded), centred under the arrow.
  const marker = (m, cx, y0, mc) => {
    const w = markW(m), x = cx - w / 2;
    return s('g', { class: `hopmark ${m.kind}`, style: `--mc:${mc}` }, s('rect', { x, y: y0 + 5, width: w, height: 17, rx: 8.5 }),
      m.kind === 'fold' ? null : s('g', { transform: `translate(${x + 6} ${y0 + 8})`, class: 'fun' }, s('path', { d: FUNNEL }), m.kind === 'all-but' ? s('path', { d: 'M1 11L11 1' }) : null),
      s('text', { x: x + (m.kind === 'fold' ? 10 : 22), y: y0 + 17 }, m.label));
  };
  // The end of the chain: a stop bar across the lifeline at the arrow tip, then the number of each async flow that starts here (or "no reader" / "no consumers").
  const stop = (end, x2, dir, y0, mc, r) => {
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
    if (e.type === 'hop') { // one arrow through the topic: its colour changes exactly on the topic lifeline; the event type reads like a REST path
      const x1 = edge(e.fromBar, e.from, 1), x2 = colX.get(e.to), tx = e.via ? colX.get(e.via) : e.fork ? colX.get(e.from) : null, mc = colorOf(e.transport), tc = colorOf(e.trunkTransport);
      let kids, left = x1, mid;
      if (e.via) { kids = [arrow(x1, tx, y0, { label: e.label, color: tc, bare: true }), arrow(tx, x2, y0, { color: mc }), s('circle', { class: 'via', cx: tx, cy: y0, r: 3.2, style: `--mc:${mc}` })]; mid = (tx + x2) / 2; }
      else if (e.fork) { // a branch: leaves the topic lifeline downwards from the arrow above it and turns right
        left = tx; mid = (tx + 6 + x2) / 2;
        kids = [s('path', { class: 'fork', d: `M${tx} ${ys[r - 1]}V${y0 - 7}Q${tx} ${y0} ${tx + 7} ${y0}`, style: `--mc:${mc}` }), arrow(tx + 6, x2, y0, { color: mc })];
      } else { kids = [arrow(x1, x2, y0, { label: e.trunk ? e.label : null, color: mc })]; mid = (x1 + x2) / 2; }
      return g('hop', ...kids, e.marker ? marker(e.marker, mid, y0, mc) : null, e.end ? stop(e.end, x2, 1, y0, mc, r) : null, hit(left, x2), s('title', {}, [e.msg.label, e.marker?.full].filter(Boolean).join('\n')));
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
    columns.map((c) => s('line', { class: isCh(c) ? 'lifeline ch' : 'lifeline', style: isCh(c) ? `--mc:${colorOf(c.transport)}` : null, x1: colX.get(c), x2: colX.get(c), y1: 0, y2: height })), rects, segs, drawn);

  const eventOf = (t) => events[Number(t.closest?.('[data-e]')?.dataset.e)];
  const barOf = (t) => { const r = t?.closest?.('[data-bar]'); return r ? bars[Number(r.dataset.bar)] : null; };
  const numOf = (t) => t?.closest?.('[data-num]');
  const foldOf = (t) => t.closest?.('[data-mwfold]');
  const fold = (el) => onMw?.(bars[Number(el.dataset.mwfold)], el.classList.contains('mwlab') ? '.mwlab' : '.mwseg'); // the redraw replaces the element: the caller refocuses by this selector
  const pillOf = (t) => { const b = t.closest?.('[data-pill]'); return b ? bars[Number(b.dataset.pill)] : null; };
  const pm = (ev) => {
    const g = ev.target.closest?.('[data-p]'), c = g && columns[Number(g.dataset.p)];
    if (c?.service && onParticipant) { ev.preventDefault(); onParticipant({ id: `svc:${c.service}`, kind: 'service', service: c.service, label: c.label }, ev.clientX, ev.clientY); }
    else if (c?.fan && onFan && ev.type === 'click') onFan(c.fan.topic);
  };
  head.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { const g = ev.target.closest?.('[data-p]'), c = g && columns[Number(g.dataset.p)]; if (c?.fan) { ev.preventDefault(); onFan?.(c.fan.topic); } } });
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
    const bd = numOf(ev.target), pill = pillOf(ev.target), b = barOf(ev.target), e = eventOf(ev.target);
    if (foldOf(ev.target)) { if (ev.detail <= 1) { const f = foldOf(ev.target); clearTimeout(foldTimer); foldTimer = setTimeout(() => fold(f), 200); } } else if (bd) { ev.stopPropagation(); onNum?.(bd.dataset.num); } else if (pill) onBar?.(pill); else if (b) onBar?.(b, 'select'); else if (e?.msg) onMessage?.(e.msg, ev.target.closest('[data-e]'), e);
  });
  body.addEventListener('keydown', (ev) => {
    if (ev.key !== 'Enter' && ev.key !== ' ') return;
    ev.preventDefault();
    const bd = numOf(ev.target), pill = pillOf(ev.target), b = barOf(ev.target), e = eventOf(ev.target);
    if (foldOf(ev.target)) fold(foldOf(ev.target)); else if (bd) onNum?.(bd.dataset.num); else if (pill) onBar?.(pill); else if (b) onBar?.(b); else if (e?.msg) onMessage?.(e.msg, ev.target.closest('[data-e]'), e);
  });
  // a tile and its list row light up together
  const own = (el) => (el.dataset.own ?? '').split(' ').filter(Boolean);
  body.addEventListener('mouseover', (ev) => { const t = numOf(ev.target); if (t && numOf(ev.relatedTarget) !== t) onNumHover?.(own(t), true); });
  body.addEventListener('mouseout', (ev) => { const t = numOf(ev.target); if (t && numOf(ev.relatedTarget) !== t) onNumHover?.(own(t), false); });
  body.addEventListener('focusin', (ev) => { const t = numOf(ev.target); if (t) onNumHover?.(own(t), true); });
  body.addEventListener('focusout', (ev) => { const t = numOf(ev.target); if (t) onNumHover?.(own(t), false); });
  const mark = (label, on) => body.querySelectorAll('.numtile').forEach((t) => { if (own(t).includes(label)) t.classList.toggle('hl', on); });
  body.__events = events;
  return { el: h('div.seq', h(sticky ? 'div.seq-sticky' : 'div.seq-head-static', head), body), body, events, bars, mark };
}
