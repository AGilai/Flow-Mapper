// One tab's content: (a sub-flow's breadcrumb and lane summary), the flow's diagram, and under it the list of its async
// sub-flows. Every tab keeps its own DOM, so scroll, expanded rows, the drill-down panel and the selected bar are its
// memory; hiding a tab does not tear it down.

import { h, fill } from '../dom.js';
import { renderLane } from './flow-draw.js';
import { buildLane } from './flow-lane.js';
import { renderIndex } from './flow-index.js';
import { createInside } from './flow-inside-panel.js';
import { messagePanel } from './flow-panel.js';
import { participantMenu, barMenu } from './flow-menu.js';
import { plural } from './flow-async.js';
import { descBlock, descLine } from './flow-desc.js';
import { createTip } from './flow-desc-tip.js';
import { openGenerate } from './flow-desc-dialog.js';

const tc = (t, label) => h('span.tc', { class: t, title: label }, label);
const kindOf = (key) => String(key).split(':')[0].replace('amqp-queue', 'amqp');

/**
 * createTabView(data, host, active) -> { el, key, draw(), save(), restore(), refreshDots(), insideOpen(), clearMessage(), dispose() }
 * host: { env, opts, panel, flowsEl, describe(key), openTab(key), openSub(row, origin), openFull(row, origin), openMany(rows, origin),
 *         openEntry(spec), isOpen(row, origin), setFrontier(), isActive(key), desc (the description store), rootOf(key) -> {service, ingress} | null }
 */
export function createTabView(data, host) {
  const { trace, tree, key } = data;
  const opts = host.opts, mwOpen = new Set(); // keys of the bars whose long middleware chain is unfolded
  let index = null, lane = null, saved = 0;
  // Descriptions belong to the flow (service + ingress of its entry point; a sub-flow tab belongs to the flow it came from). A function tab has none.
  const root = host.desc ? host.rootOf(key) : null, services = [...new Set(trace.participants.filter((p) => p.kind === 'service').map((p) => p.label))];
  const generate = (callee) => openGenerate({ env: host.env, root, services, callee, onClose: () => host.desc.refresh(root) });
  const descs = [];
  const flowBox = root && data.kind !== 'sub' ? descBlock(host.desc, root, null, { title: 'What this flow is for', wholeFlow: true, onGenerate: () => generate(null) }) : null;
  const subLine = root && data.kind === 'sub' ? descLine(host.desc, root, [`${data.service}:${data.name}`, data.service], { onGenerate: () => generate(data.service) }) : null;
  descs.push(flowBox, subLine);
  const tip = root ? createTip(host.desc, root) : null;
  const scroller = h('div.seq-scroll');
  const hint = h('span.seq-hint', 'More to the right. Scroll sideways ›');
  const wrap = h('div.seq-wrap', scroller, hint);
  const body = h('div.flow-body', { role: 'tabpanel', 'aria-label': host.describe(key).tip }, wrap);
  const edge = () => { wrap.classList.toggle('scrolls', scroller.scrollWidth > scroller.clientWidth + 2); wrap.classList.toggle('at-end', scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4); };
  scroller.addEventListener('scroll', () => { edge(); tip?.hide(); }, { passive: true });
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(edge) : null;
  ro?.observe(scroller);
  const select = (bar) => { body.querySelectorAll('.act.selected').forEach((e) => e.classList.remove('selected')); bar?.el?.classList.add('selected'); };
  const inside = createInside(body, { env: host.env, isActive: () => host.isActive(key),
    desc: root ? (bar) => descBlock(host.desc, root, bar.service, { title: `What ${bar.service} does here`, onGenerate: () => generate(bar.service) }) : null,
    onOpen: () => { host.panel.close(); host.flowsEl.classList.add('fi-open'); }, onClose: () => { host.flowsEl.classList.remove('fi-open'); select(null); }, onStep: (m) => markArrow(m) });
  function markArrow(m) { // a step in the drill-down marks its arrow
    body.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active'));
    const g = [...body.querySelectorAll('.seq-body')].map((b) => ({ b, k: b.__events?.findIndex((e) => e.msg === m) })).find((x) => x.k >= 0);
    const el = g?.b.querySelector(`[data-e="${g.k}"]`);
    el?.classList.add('active');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  const laneOpts = () => ({ mwOpen, stores: opts.stores, scope: 'full', maxDepth: opts.depth === 'all' ? Infinity : Number(opts.depth) });
  const lookInside = (bar) => { select(bar); inside.open(bar, trace); };
  const flash = (g) => { g?.scrollIntoView({ block: 'center', behavior: 'smooth' }); g?.classList.add('flash'); setTimeout(() => g?.classList.remove('flash'), 1600); };
  const handlers = {
    onBarTip: tip ? (bar, el) => (bar ? tip.show(bar, el) : tip.hide()) : undefined,
    onMw: (bar, sel) => { const k = bar?.mw?.key; if (!k) return; if (!mwOpen.delete(k)) mwOpen.add(k); draw(); body.querySelector(`${sel ?? '.mwlab'}[data-mwfold="${bar.id}"]`)?.focus(); },
    onBar: (bar, mode) => { if (mode === 'select') select(bar); else lookInside(bar); },
    onBarMenu: (bar, x, y) => barMenu(bar, x, y, { trace, openEntry: host.openEntry, inside: () => lookInside(bar), toIndex: index ? () => index.el.scrollIntoView({ behavior: 'smooth' }) : null }),
    onParticipant: (p, x, y) => participantMenu(p, x, y, { trace, openEntry: host.openEntry }),
    onBadge: (ev) => { // one flow: open its tab; several: scroll to their group in the list below
      const at = trace.messages.indexOf(ev.msg), g = index?.groupEl(at);
      const only = ev.flows === 1 ? tree.rows.find((r) => r.i > at && g?.contains(index.rowNode(r.label))) : null;
      if (only?.ingress && !only.noHandler) host.openSub(only, key); else flash(g);
    },
    onMessage: async (m, g) => { // clicking a frontier marker expands the frontier steps
      if (m.kind === 'frontier') { host.setFrontier(); return; }
      body.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active'));
      g.classList.add('active');
      inside.close(); // one side panel at a time
      host.flowsEl.classList.add('mp-open');
      host.panel.open(...messagePanel(m, trace, host.env, data.scope ?? 'full', host.openEntry));
    },
  };

  function head() { // breadcrumb and lane summary: sub-flow and full-flow tabs only
    if (!data.originKey) return flowBox ? h('div.tpad', flowBox.el) : null;
    const o = host.describe(data.originKey), sub = data.kind === 'sub';
    const crumbs = h('div.crumbs', { 'aria-label': 'Breadcrumb' },
      h('a', { href: '#', title: 'Go to the tab this flow was opened from', on: { click: (e) => { e.preventDefault(); host.openTab(data.originKey); } } }, o.tn ? `${o.tn} · ${o.title}` : `${o.title} · ${o.sub}`),
      h('i.arr', '›'),
      sub && data.group ? [h('span.mono', `publish ${data.group.topic} · step ${data.group.pub + 1}`), h('i.arr', '›')] : null,
      h('b', sub ? `${data.label} · ${data.service} · ${data.name}` : `Full flow · ${data.service} · ${data.name}`));
    const r = data.row;
    const laneRow = sub ? h('div.tp-lane', data.group?.topic && data.group.topic !== r.queue ? [tc(kindOf(data.group.topic), data.group.topic), h('i.arr', '›')] : null, tc(kindOf(r.queue), r.queue), h('i.arr', '›'),
      h('span.svc', h('b', r.service), h('span.mono', ` · ${r.handler}`)), h('span.muted.small', r.summary), h('span.grow'),
      h('button.btn.sm', { title: `Every call ${data.service} makes from here`, on: { click: () => host.openFull(data.row, key) } }, 'Start a full flow from here')) : null;
    return h('div.tpad', crumbs, subLine?.el, laneRow, flowBox?.el);
  }

  function draw() {
    const lo = laneOpts();
    const msgs = (data.msgs ?? trace.messages).filter((m, i) => (data.kind === 'sub' && i === 0) || m.depth <= lo.maxDepth);
    lane = renderLane(buildLane(msgs, { mwOpen, stores: lo.stores, scope: data.kind === 'sub' ? 'full' : trace.scope, participants: trace.participants }), handlers);
    index = tree.groups.length ? renderIndex(tree, { trace, lane: lo, handlers, key, open: (row, full) => (full ? host.openFull(row, key) : host.openSub(row, key)),
      openAll: (rows) => host.openMany(rows, key), isOpen: (row) => host.isOpen(row, key), jump: (label) => host.jumpToLabel(label) }) : null;
    fill(scroller, head(), lane.el, index?.el);
    edge(); requestAnimationFrame(edge);
  }
  draw();
  return {
    el: body, key, data, draw, insideOpen: () => inside.isOpen(), dispose: () => { inside.dispose(); ro?.disconnect(); tip?.dispose(); descs.forEach((d) => d?.dispose()); },
    save: () => { saved = scroller.scrollTop; },
    restore: () => { scroller.scrollTop = saved; edge(); requestAnimationFrame(edge); },
    refreshDots: () => index?.refresh(),
    clearMessage: () => body.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active')),
    info: () => { const services = new Set(trace.messages.map((m) => m.service).filter(Boolean)); const n = data.msgs?.length ?? trace.messages.length; return `${trace.start.event && !data.msgs ? `${trace.start.event}: ` : ''}${plural(n, 'step')}${data.msgs ? '' : `, ${plural(services.size, 'service')}${trace.truncated ? ', truncated' : ''}`}`; },
    closeInside: () => inside.close(),
  };
}
