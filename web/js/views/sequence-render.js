// Sequence diagram renderer (SVG). Lifelines across, messages down.
// The header row is a separate sticky SVG so lifeline names stay visible while scrolling long flows.
//
//   solid arrow, filled head  = sync call      dashed, open head = async
//   red dashed with ×          = call that matches nothing
//   arrow colour               = transport (http, sns, sqs, amqp, data store)
// Right-click (or click) a lifeline header to get its menu: onParticipant(participant, x, y).

import { h, s } from '../dom.js';

const COL = 168, HEAD = 56, ROW = 30, PAD = 24, GUTTER = 44;
const KIND_LABEL = { client: 'caller', function: 'function', service: 'service', channel: 'queue / topic', resource: 'data store', missing: 'no match' };
const T_VAR = { http: '--t-http', rpc: '--t-rpc', grpc: '--t-http', eventbridge: '--t-eb', sns: '--t-sns', sqs: '--t-sqs', amqp: '--t-amqp', cron: '--t-cron', res: '--t-res' };

export function renderSequence(trace, { onMessage, onParticipant, expanded = new Set(), internal = true, stores = true, maxDepth = Infinity } = {}) {
  const msgs = trace.messages.filter((m) => (internal || m.kind !== 'call') && (stores || m.kind !== 'resource') && m.depth <= maxDepth);
  const used = new Set(msgs.flatMap((m) => [m.from, m.to]));
  const parts = trace.participants.filter((p) => used.has(p.id));
  const x = new Map(parts.map((p, i) => [p.id, GUTTER + PAD + i * COL + COL / 2]));
  const width = GUTTER + PAD * 2 + parts.length * COL;
  const height = PAD + msgs.length * ROW + PAD;

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
    parts.map((p) => s('line', { class: 'lifeline', x1: x.get(p.id), x2: x.get(p.id), y1: 0, y2: height })),
    msgs.map((m, i) => message(m, i, x)));

  const partMenu = (ev) => {
    const g = ev.target.closest?.('[data-p]');
    if (!g || !onParticipant) return;
    ev.preventDefault();
    onParticipant(parts[Number(g.dataset.p)], ev.clientX, ev.clientY);
  };
  head.addEventListener('contextmenu', partMenu);
  head.addEventListener('click', partMenu);

  body.addEventListener('click', (ev) => {
    const g = ev.target.closest?.('[data-i]');
    if (g) onMessage?.(msgs[Number(g.dataset.i)], g);
  });
  body.addEventListener('keydown', (ev) => {
    const g = ev.target.closest?.('[data-i]');
    if (g && (ev.key === 'Enter' || ev.key === ' ')) { ev.preventDefault(); onMessage?.(msgs[Number(g.dataset.i)], g); }
  });

  return { el: h('div.seq', h('div.seq-sticky', head), body), shown: msgs.length, total: trace.messages.length };
}

function message(m, i, x) {
  const y = PAD + i * ROW + ROW / 2 + 4;
  const x1 = x.get(m.from), x2 = x.get(m.to);
  const color = m.broken ? 'var(--t-broken)' : m.transport ? `var(${T_VAR[m.transport] ?? '--ink-2'})` : 'var(--ink-2)';
  const dashed = m.broken || m.mode === 'async';
  const g = s('g', { class: `msg${m.broken ? ' broken' : ''}`, 'data-i': i, tabindex: 0, role: 'button', style: `--mc: ${color}` });
  // depth rail in the gutter
  g.append(s('text', { x: 8, y: y + 4, class: 'depth' }, String(m.depth)));
  const tags = [m.loop ? 'loop' : null, m.condition ? `if ${m.condition}` : null, m.cycle ? 'cycle' : null].filter(Boolean).join(', ');
  const label = clip(m.label, Math.max(34, Math.floor(Math.abs(x2 - x1) / 7.2) || 34)) + (tags ? `  [${tags}]` : '');
  if (x1 === x2) {
    g.append(s('path', { d: `M${x1} ${y - 8} h28 v14 h-26`, class: 'arrow', 'marker-end': dashed ? 'url(#ao)' : 'url(#ah)', 'stroke-dasharray': dashed ? '5 4' : null }));
    g.append(s('text', { x: x1 + 34, y: y + 2, class: 'label' }, label));
  } else {
    const dir = Math.sign(x2 - x1);
    g.append(s('line', { x1, x2: x2 - dir * 2, y1: y, y2: y, class: 'arrow', 'marker-end': dashed ? 'url(#ao)' : 'url(#ah)', 'stroke-dasharray': dashed ? '5 4' : null }));
    g.append(s('text', { x: Math.min(x1, x2) + 6, y: y - 6, class: 'label' }, label));
    if (m.broken) g.append(s('path', { d: `M${x2 - 5} ${y - 5}l10 10M${x2 + 5} ${y - 5}l-10 10`, class: 'x' }));
  }
  g.append(s('rect', { x: Math.min(x1, x2) - 4, y: y - 16, width: Math.max(40, Math.abs(x2 - x1) + 40), height: ROW - 2, class: 'hit' }));
  g.append(s('title', {}, `${m.label}${m.fn ? `\nin ${m.service}: ${m.fn}` : ''}`));
  return g;
}

const chType = (id) => id.replace(/^ch:/, '').split(':')[0].replace('amqp-queue', 'amqp');
const clip = (t, n) => (t.length > n ? t.slice(0, n - 1) + '…' : t);
