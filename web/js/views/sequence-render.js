// Sequence diagram renderer (SVG). Lifelines across, messages down.
// The header row is a separate sticky SVG so lifeline names stay visible while scrolling long flows.
//
//   solid arrow, filled head  = sync call      dashed, open head = async
//   red dashed with ×          = call that matches nothing
//   arrow colour               = transport (http, sns, sqs, amqp, data store)
// Right-click (or click) a lifeline header to get its menu: onParticipant(participant, x, y).

import { h, s } from '../dom.js';
import { asyncFlowOf, gapRows, gapsAbove, flowSpans } from './sequence-plan.js';
import { altFrames, stripsByRow, drawFrames, STRIP } from './sequence-alt.js';

const COL = 168, HEAD = 56, ROW = 30, GAP = ROW / 2, PAD = 24, GUTTER = 44;
const chipOf = (m) => (m.repeatOf ? `↩ step ${m.repeatOf}` : '');
const chipW = (m) => (m.repeatOf ? chipOf(m).length * CH + 14 : 0);
const plainLabel = (m) => (m.repeatOf ? m.label.replace(/\s*↩ seen at step \d+$/, '') : m.label);
const CH = 7.4; // width of one label character: 12px monospace is 7.2px, plus a little room
export const colX = (i) => GUTTER + PAD + i * COL + COL / 2;
const KIND_LABEL = { client: 'caller', function: 'function', service: 'service', channel: 'queue / topic', resource: 'data store', missing: 'no match', unresolved: 'harvester gap' };
const T_VAR = { http: '--t-http', rpc: '--t-rpc', grpc: '--t-http', eventbridge: '--t-eb', sns: '--t-sns', sqs: '--t-sqs', amqp: '--t-amqp', cron: '--t-cron', res: '--t-res' };

/**
 * Queues and topics hidden: a send that passes through them is the one arrow from the sender to the
 * consumer it reaches. A queue nothing reads stays, so the send is still visible.
 */
export function bridgeChannels(messages) {
  const bridged = new Set();
  for (let again = true; again;) {
    again = false;
    for (const m of messages) {
      if (!m.from.startsWith('ch:') || bridged.has(m.from) || m.from === m.to) continue;
      if (!m.to.startsWith('ch:') || bridged.has(m.to)) { bridged.add(m.from); again = true; }
    }
  }
  const origin = new Map();
  const out = [];
  for (const m of messages) {
    if (m.to.startsWith('ch:') && bridged.has(m.to)) { if (!origin.has(m.to)) origin.set(m.to, origin.get(m.from) ?? m.from); continue; }
    if (m.from.startsWith('ch:') && bridged.has(m.from)) out.push({ ...m, from: origin.get(m.from) ?? m.from, kind: 'egress' });
    else out.push(m);
  }
  return out;
}

/**
 * Row of each message. One row per message, except that the hops of one delivery share a row:
 * publish -> queue -> consumer for a single queue, topic -> queue -> consumer for each leg of a fan-out.
 * The queue sits level with the consumer that pulls from it. A delivery that points back over its publish (consumer
 * left of the queue where the publish came from the left, or the reverse) would overlap it, so it gets its own row (#35).
 * `x` (participant id -> column x) is optional; without it only a delivery back to the publisher counts as pointing back.
 */
export function rowsOf(msgs, x) {
  const rows = [];
  let n = -1;
  msgs.forEach((m, i) => {
    const p = msgs[i - 1];
    // A hop out of a channel continues the hop into it, unless that hop is a fan-out publish (its deliveries get their own rows).
    const sameDelivery = p && p.to === m.from && p.from !== p.to && m.from.startsWith('ch:') && !p.deliveries && !pointsBack(p, m, x);
    rows.push(sameDelivery ? n : ++n);
  });
  return { rows, count: n + 1 };
}

function pointsBack(p, m, x) {
  if (!x) return m.to === p.from;
  return Math.sign(x.get(p.to) - x.get(p.from)) !== Math.sign(x.get(m.to) - x.get(m.from));
}

export function renderSequence(trace, { onMessage, onParticipant, onOpenFlow, onFlowMenu, expanded = new Set(), internal = true, stores = true, queues = true, maxDepth = Infinity } = {}) {
  // With queues hidden the fan-out is not drawn: direct arrows, one row each, as before.
  const plain = (m) => { const { group, deliveries, delivery, ...rest } = m; return rest; };
  const msgs = (queues ? trace.messages : bridgeChannels(trace.messages).map(plain)).filter((m) => (internal || m.kind !== 'call') && (stores || m.kind !== 'resource') && m.depth <= maxDepth);
  const used = new Set(msgs.flatMap((m) => [m.from, m.to]));
  const parts = trace.participants.filter((p) => used.has(p.id));
  const x = new Map(parts.map((p, i) => [p.id, colX(i)]));
  const width = GUTTER + PAD * 2 + parts.length * COL;
  const { rows, count } = rowsOf(msgs, x);
  const plan = labelPlan(msgs, rows, x);
  // Alt frames: each section gets a strip for its condition above its first row, so rows below shift down.
  const frames = altFrames(msgs);
  const strips = stripsByRow(frames, rows);
  const nStrips = (r) => strips.get(r)?.length ?? 0;
  const above = []; // strips in all rows before r
  for (let r = 0, n = 0; r <= count; r++) { above[r] = n; n += nStrips(r); }
  const gapAt = gapsAbove(gapRows(msgs, rows), count); // half-row of space before each async sub-flow
  const rowTop = (r) => PAD + r * ROW + above[r] * STRIP + gapAt[r] * GAP;
  const height = PAD + count * ROW + above[count] * STRIP + gapAt[count] * GAP + PAD;
  const { spans, colorOf, spanOf } = flowSpans(msgs, trace.messages);
  const rowY = (r) => rowTop(r) + nStrips(r) * STRIP + ROW / 2 + 4;
  // Activation bar on the topic lifeline: from the publish row to its last delivery.
  const bars = msgs.flatMap((m, i) => {
    if (!m.deliveries) return [];
    const last = rows.reduce((a, r, j) => (msgs[j].group === m.group && msgs[j].delivery ? Math.max(a, r) : a), rows[i]);
    return [s('rect', { class: 'activation', x: x.get(m.to) - 5, y: rowY(rows[i]) - 10, width: 10, height: rowY(last) - rowY(rows[i]) + 20, rx: 2 }, s('title', {}, `${m.deliveries} deliveries`))];
  });

  const head = s('svg', { width, height: HEAD, class: 'seq-head', role: 'presentation' },
    parts.map((p, i) => {
      const cx = x.get(p.id);
      // functions of a service other than the trace's start are labelled with their service
      const sub = p.kind === 'function' && p.service !== trace.start.service ? `fn in ${p.service}` : KIND_LABEL[p.kind] ?? p.kind;
      return s('g', { class: `seq-part k-${p.kind}${p.kind === 'function' && expanded.has(p.service) ? ' expanded' : ''}`, 'data-p': i, transform: `translate(${cx - COL / 2 + 8},8)` },
        s('rect', { width: COL - 16, height: HEAD - 16, rx: 8 }),
        s('rect', { class: 'stripe', width: 4, height: HEAD - 16, rx: 2, style: p.kind === 'channel' ? `fill: var(${T_VAR[chType(p.id)] ?? '--t-res'})` : null }),
        s('text', { x: 12, y: 18, class: 'name' }, clip(p.label, 20)),
        s('text', { x: 12, y: 33, class: 'sub' }, clip(sub, 24)),
        s('title', {}, p.label));
    }));

  const body = s('svg', { width, height, class: 'seq-body', role: 'img', 'aria-label': `Sequence of ${msgs.length} messages across ${parts.length} participants` },
    s('defs', {},
      s('marker', { id: 'ah', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, s('path', { d: 'M0 0L10 5L0 10z', fill: 'context-stroke' })),
      s('marker', { id: 'ao', viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' }, s('path', { d: 'M1 1L9 5L1 9', fill: 'none', stroke: 'context-stroke', 'stroke-width': 1.5 }))),
    spans.map((sp) => s('rect', { class: `flow-band c${sp.color}`, 'data-band': sp.i, x: GUTTER + 2 + sp.level * 7, y: rowTop(rows[sp.start]) - 1, width: width - GUTTER - 4 - sp.level * 7, height: rowTop(rows[sp.end]) + nStrips(rows[sp.end]) * STRIP + ROW - rowTop(rows[sp.start]) + 1, rx: 4 })),
    drawFrames(frames, rows, strips, rowTop, (r) => rowTop(r) + nStrips(r) * STRIP + ROW, width, GUTTER),
    parts.map((p) => s('line', { class: 'lifeline', x1: x.get(p.id), x2: x.get(p.id), y1: 0, y2: height })),
    bars,
    msgs.map((m, i) => message(m, i, x, rowY(rows[i]), rail(msgs, rows, i), plan[i])),
    msgs.map((m, i) => (asyncFlowOf(m) ? flowDot(m, i, x, rowY(rows[i]), colorOf.get(i), spanOf.has(i)) : null)));

  const partMenu = (ev) => {
    const g = ev.target.closest?.('[data-p]');
    if (!g || !onParticipant) return;
    ev.preventDefault();
    onParticipant(parts[Number(g.dataset.p)], ev.clientX, ev.clientY);
  };
  head.addEventListener('contextmenu', partMenu);
  head.addEventListener('click', partMenu);

  const dotOf = (ev) => ev.target.closest?.('[data-dot]');
  const jump = (sp) => { // scroll the sub-flow into view and flash its band
    const band = body.querySelector(`[data-band="${sp.i}"]`);
    if (!band) return;
    band.scrollIntoView({ block: 'start', behavior: 'smooth' });
    band.classList.add('flash');
    setTimeout(() => band.classList.remove('flash'), 1800);
  };
  const dotMenu = (i, ev) => { // right-click on a dot or on the delivery arrow
    if (!asyncFlowOf(msgs[i]) || !onFlowMenu) return false;
    ev.preventDefault();
    onFlowMenu(asyncFlowOf(msgs[i]), msgs[i], ev.clientX, ev.clientY, spanOf.has(i) ? () => jump(spanOf.get(i)) : null);
    return true;
  };
  const openDot = (g, ev) => { // click: jump to the sub-flow below; shift/ctrl/cmd-click, or no sub-flow to jump to: open its own flow
    const i = Number(g.dataset.dot);
    if (spanOf.has(i) && !(ev.shiftKey || ev.ctrlKey || ev.metaKey)) jump(spanOf.get(i));
    else onOpenFlow?.(asyncFlowOf(msgs[i]), msgs[i]);
  };
  body.addEventListener('contextmenu', (ev) => {
    const d = dotOf(ev), g = d ?? ev.target.closest?.('[data-i]');
    if (g) dotMenu(Number(d ? g.dataset.dot : g.dataset.i), ev);
  });
  body.addEventListener('click', (ev) => {
    const d = dotOf(ev);
    if (d) { ev.stopPropagation(); openDot(d, ev); return; }
    const g = ev.target.closest?.('[data-i]');
    if (g) onMessage?.(msgs[Number(g.dataset.i)], g);
  });
  body.addEventListener('keydown', (ev) => {
    const d = dotOf(ev);
    if (d) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDot(d, ev); } return; }
    const g = ev.target.closest?.('[data-i]');
    if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onMessage?.(msgs[Number(g.dataset.i)], g); }
  });

  return { el: h('div.seq', h('div.seq-sticky', head), body), shown: msgs.length, total: trace.messages.length };
}


/**
 * Where each label goes and how much of it fits (#35). A label starts at its own arrow's start and never runs past
 * the arrow's end, so arrows side by side on one row (a publish and its delivery) keep their own labels. Where arrow
 * spans still overlap on a row (a long arrow back across others), a label also stops short of the next label to its
 * right. Clipped text ends in an ellipsis; the full text is the tooltip. Returns [{ x, text, width }] per message.
 */
export function labelPlan(msgs, rows, x) {
  const plan = msgs.map((m) => {
    const x1 = x.get(m.from), x2 = x.get(m.to);
    const tags = [m.loop ? 'loop' : null, m.condition && !m.alt ? `if ${m.condition}` : null, m.cycle ? 'cycle' : null].filter(Boolean).join(', ');
    const suffix = tags ? `  [${tags}]` : '';
    const full = (m.kind === 'frontier' ? `${m.label}  (click to show)` : plainLabel(m));
    const start = x1 === x2 ? x1 + 34 : Math.min(x1, x2) + 6 + (m.repeatOf && x2 < x1 ? chipW(m) + 10 : 0); // a leftward repeat has its chip at the left end
    const room = x1 === x2 ? 34 : Math.max(4, Math.floor((Math.abs(x2 - x1) - 12 - chipW(m)) / CH));
    return { start, full, suffix, room };
  });
  const byRow = new Map();
  plan.forEach((p, i) => byRow.set(rows[i], [...(byRow.get(rows[i]) ?? []), i]));
  for (const idx of byRow.values()) {
    idx.sort((a, b) => plan[a].start - plan[b].start);
    idx.forEach((i, k) => {
      const next = plan[idx[k + 1]];
      if (next && next.start > plan[i].start) plan[i].room = Math.max(4, Math.min(plan[i].room, Math.floor((next.start - plan[i].start - 6) / CH)));
    });
  }
  return plan.map((p) => {
    const text = clip(p.full, Math.max(4, p.room - p.suffix.length)) + p.suffix;
    return { x: p.start, text, width: text.length * CH };
  });
}

/** The dot at the arrowhead of a delivery that reaches a consumer ingress: opens that consumer's own flow. */
function flowDot(m, i, x, y, color, canJump) {
  const f = asyncFlowOf(m), x2 = x.get(m.to), dir = Math.sign(x2 - x.get(m.from)) || 1;
  const lines = [`Async flow: ${f.service} · ${f.ingress}`, canJump ? `Click: jump to the async flow ${m.repeatOf ? `(first seen at step ${m.repeatOf})` : 'below'} · Right-click: more` : 'Click: open the async flow · Right-click: more'];
  const w = Math.max(...lines.map((l) => l.length)) * 6.6 + 16, tx = dir > 0 ? x2 - w + 10 : x2 - 10;
  return s('g', { class: 'flow-dot', 'data-dot': i, tabindex: 0, role: 'link', 'aria-label': lines.join('. '), style: `--mc: var(--flow-${color ?? 1})` },
    s('circle', { cx: x2, cy: y, r: 9, class: 'dot-hit' }),
    s('circle', { cx: x2, cy: y, r: 5, class: 'dot' }),
    s('g', { class: 'dot-tip', 'aria-hidden': 'true' },
      s('rect', { x: tx, y: y - 22 - lines.length * 15, width: w, height: lines.length * 15 + 6, rx: 4 }),
      lines.map((l, k) => s('text', { x: tx + 8, y: y - 21 - (lines.length - 1 - k) * 15 }, l))));
}

/** Left-rail label: the call depth; a delivery of a fan-out is `depth.delivery`, shown once per row. */
function rail(msgs, rows, i) {
  const m = msgs[i];
  if (i && rows[i - 1] === rows[i]) return '';
  return m.delivery ? `${m.depth}.${m.delivery}` : String(m.depth);
}

function message(m, i, x, y, railLabel, plan) {
  const x1 = x.get(m.from), x2 = x.get(m.to);
  const color = m.broken ? 'var(--t-broken)' : m.gap ? 'var(--muted)' : m.transport ? `var(${T_VAR[m.transport] ?? '--ink-2'})` : 'var(--ink-2)';
  const dashed = m.broken || m.gap || m.mode === 'async' || m.possible || m.kind === 'frontier';
  const g = s('g', { class: `msg${m.broken ? ' broken' : ''}${m.gap ? ' gap' : ''}${m.possible ? ' possible' : ''}${m.kind === 'frontier' ? ' frontier' : ''}${m.kind === 'leaf' ? ' leaf' : ''}${m.repeatOf ? ' repeat' : ''}${m.origin === 'frontier' ? ' from-frontier' : ''}`, 'data-i': i, tabindex: 0, role: 'button', style: `--mc: ${color}` });
  // depth rail in the gutter
  g.append(s('text', { x: 8, y: y + 4, class: 'depth' }, railLabel));
  const tags = [m.loop ? 'loop' : null, m.condition && !m.alt ? `if ${m.condition}` : null, m.cycle ? 'cycle' : null].filter(Boolean).join(', ');
  const { text: label, x: labelX } = plan;
  if (x1 === x2) {
    g.append(s('path', { d: `M${x1} ${y - 8} h28 v14 h-26`, class: 'arrow', 'marker-end': dashed ? 'url(#ao)' : 'url(#ah)', 'stroke-dasharray': dashed ? '5 4' : null }));
    g.append(s('text', { x: labelX, y: y + 2, class: 'label' }, label));
  } else {
    const dir = Math.sign(x2 - x1);
    g.append(s('line', { x1, x2: x2 - dir * 2, y1: y, y2: y, class: 'arrow', 'marker-end': dashed ? 'url(#ao)' : 'url(#ah)', 'stroke-dasharray': dashed ? '5 4' : null }));
    g.append(s('text', { x: labelX, y: y - 6, class: 'label' }, label));
    if (m.repeatOf) { // a muted arrow ending in a chip, so a repeat cannot be mistaken for a [cycle] row
      const w = chipW(m), cx = x2 - dir * (w / 2 + 10);
      g.append(s('rect', { x: cx - w / 2, y: y - 9, width: w, height: 18, rx: 9, class: 'chip' }), s('text', { x: cx, y: y + 4, class: 'chip-text', 'text-anchor': 'middle' }, chipOf(m)));
    }
    if (m.broken) g.append(s('path', { d: `M${x2 - 5} ${y - 5}l10 10M${x2 + 5} ${y - 5}l-10 10`, class: 'x' }));
  }
  g.append(s('rect', { x: Math.min(x1, x2) - 4, y: y - 16, width: Math.max(40, Math.abs(x2 - x1) + 40), height: ROW - 2, class: 'hit' }));
  g.append(s('title', {}, `${m.label}${m.condition ? `  [if ${m.condition}]` : ''}${m.fn ? `\nin ${m.service}: ${m.fn}` : ''}`));
  return g;
}

const chType = (id) => id.replace(/^ch:/, '').split(':')[0].replace('amqp-queue', 'amqp');
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
