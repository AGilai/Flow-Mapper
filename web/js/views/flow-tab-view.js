// One tab's content: (a sub-flow's breadcrumb and lane summary), the flow's diagram, and under it the list of its async
// sub-flows. Every tab keeps its own DOM, so scroll, expanded rows, the drill-down panel and the selected bar are its
// memory; hiding a tab does not tear it down.

import { h, fill } from '../dom.js';
import { createFlowRender } from './flow-render.js';
import { createInside } from './flow-inside-panel.js';
import { messagePanel } from './flow-panel.js';
import { publishPanel } from './flow-panel-publish.js';
import { plural } from './flow-async.js';
import { descBlock, descLine } from './flow-desc.js';
import { descDetails } from './flow-head.js';
import { createWalkView } from './flow-walk-view.js';
import { createTip } from './flow-desc-tip.js';
import { openGenerate } from './flow-desc-dialog.js';
import { flowId } from './flow-sub.js';

const tc = (t, label) => h('span.tc', { class: t, title: label }, label);
const kindOf = (key) => String(key).split(':')[0].replace('amqp-queue', 'amqp');

/**
 * createTabView(data, host, active) -> { el, key, draw(), save(), restore(), refreshDots(), insideOpen(), clearMessage(), dispose() }
 * host: { env, opts, panel, flowsEl, traceFor(request), describe(key), openTab(key), openSub(row, origin), openFull(row, origin), openMany(rows, origin),
 *         openEntry(spec), isOpen(row, origin), setFrontier(), isActive(key), desc (the description store), rootOf(key) -> {service, ingress} | null }
 */
export function createTabView(data, host) {
  const { trace, tree, key } = data;
  const opts = host.opts, mwOpen = new Set(); // keys of the bars whose long middleware chain is unfolded
  let render = null, saved = 0;
  // Descriptions belong to the flow (service + ingress of its entry point; a sub-flow tab belongs to the flow it came from). A function tab has none.
  const root = host.desc ? host.rootOf(key) : null, services = [...new Set(trace.participants.filter((p) => p.kind === 'service').map((p) => p.label))];
  const generate = (callee) => openGenerate({ env: host.env, root, services, callee, onClose: () => host.desc.refresh(root) });
  const descs = [];
  const label = host.describe(key);
  // The flow's description sits under its title, full width and collapsible (0.20.0); a sub-flow tab keeps its one line.
  const flowBox = root && data.kind !== 'sub' ? descDetails(host.desc, root, null, { cls: 'flowhead', remember: 'flowhead-open', title: 'What this flow is for', onGenerate: () => generate(null),
    summary: [h('span.fh-t', label.title), label.sub ? h('span.mono.xs.muted', label.sub) : null, h('span.xs.muted.fh-src', 'What this flow is for')] }) : null;
  const subLine = root && data.kind === 'sub' ? descLine(host.desc, root, [`${data.service}:${data.name}`, data.service], { onGenerate: () => generate(data.service) }) : null;
  descs.push(flowBox, subLine);
  // The step walk: numbered arrows, the bar and the step's description. Step descriptions belong to the flow, so a sub-flow or function tab walks without them.
  const walk = createWalkView({ store: host.desc, root: data.kind === 'sub' ? null : root, initial: host.initialStep?.(key) ?? null, onStep: (n) => host.setStep?.(key, n) });
  const tip = root ? createTip(host.desc, root) : null;
  const scroller = h('div.seq-scroll');
  const hint = h('span.seq-hint', 'More to the right. Scroll sideways ›');
  const wrap = h('div.seq-wrap', scroller, hint);
  const body = h('div.flow-body', { role: 'tabpanel', 'aria-label': host.describe(key).tip }, wrap);
  const edge = () => { wrap.classList.toggle('scrolls', scroller.scrollWidth > scroller.clientWidth + 2); wrap.classList.toggle('at-end', scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4); };
  scroller.addEventListener('scroll', () => { edge(); tip?.hide(); }, { passive: true });
  let sized = false; // the first time the tab has a width (it is drawn before it is attached, or while hidden), lay the lanes out to fit it
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { edge(); if (!sized && scroller.clientWidth > 0 && render) { sized = true; render.relane(); render.laneBox.style.visibility = ''; edge(); } }) : null;
  ro?.observe(scroller);
  // a side panel was collapsed or expanded: this tab has another width, so its lanes lay themselves out again (a hidden tab does so when it is shown)
  const onLayout = () => { if (!render) return; if (scroller.clientWidth > 0) { render.relane(); edge(); } else sized = false; };
  document.addEventListener('fm:layout', onLayout);
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
  const lookInside = (bar, tr) => { inside.open(bar, tr); };
  const flash = (g) => { g?.scrollIntoView({ block: 'center', behavior: 'smooth' }); g?.classList.add('flash'); setTimeout(() => g?.classList.remove('flash'), 1600); };
  const shared = { host, opts, tip, walk, fit: () => scroller.clientWidth, select, lookInside, flash, traceFor: host.traceFor,
    openMessage: (m, g, tr) => { // clicking an arrow opens the message panel; one side panel at a time
      body.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active'));
      g.classList.add('active');
      inside.close();
      host.flowsEl.classList.add('mp-open');
      host.panel.open(...messagePanel(m, tr, host.env, 'full', host.openEntry));
    } };

  function openPublish(pub, g, tr) { // the shared trunk of a fan-out: the publish, then its deliveries (each opens its own arrow)
    body.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active'));
    g.classList.add('active');
    inside.close();
    host.flowsEl.classList.add('mp-open');
    const events = g.closest('svg')?.__events ?? [];
    host.panel.open(...publishPanel(pub, (d) => { const k = events.indexOf(d.hop), el = k >= 0 ? g.closest('svg').querySelector(`[data-e="${k}"]`) : g; shared.openMessage(d.msg, el ?? g, tr); }));
  }
  shared.openPublish = openPublish;

  function head() { // breadcrumb and lane summary: sub-flow and full-flow tabs only
    if (!data.originKey) return null;
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
    return h('div.tpad', crumbs, subLine?.el, laneRow);
  }

  function draw() { // options changed (stores, depth): redraw the lane and the lanes of the open cards; their expansion stays
    if (render) { render.relane(); fill(scroller, head(), render.laneBox, render.idxBox); } else {
      render = createFlowRender({ trace, tree, key, ancestors: data.start ? [flowId(data.start)] : [] }, shared);
      if (!scroller.clientWidth) render.laneBox.style.visibility = 'hidden'; // drawn before it has a width: show it once laid out to fit
      fill(scroller, head(), render.laneBox, render.idxBox);
    }
    edge(); requestAnimationFrame(edge);
  }
  draw();
  const el = h('div.flow-tab', h('div.flow-top', flowBox?.el, walk.el), body);
  el.addEventListener('keydown', (ev) => walk.onKey(ev)); // ← → Home End, while focus is in the flow view and not in a text box
  return {
    el, key, data, draw, insideOpen: () => inside.isOpen(), dispose: () => { document.removeEventListener('fm:layout', onLayout); inside.dispose(); ro?.disconnect(); tip?.dispose(); descs.forEach((d) => d?.dispose()); walk.dispose(); },
    save: () => { saved = scroller.scrollTop; },
    restore: () => { scroller.scrollTop = saved; edge(); requestAnimationFrame(edge); },
    refreshDots: () => render?.index()?.refresh(),
    clearMessage: () => body.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active')),
    info: () => { const services = new Set(trace.messages.map((m) => m.service).filter(Boolean)); return `${trace.start.event ? `${trace.start.event}: ` : ''}${plural(trace.messages.length, 'step')}, ${plural(services.size, 'service')}${trace.truncated ? ', truncated' : ''}`; },
    closeInside: () => inside.close(),
  };
}
