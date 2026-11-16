// One tab's content: (a sub-flow's breadcrumb and lane summary), the flow's diagram, and under it the list of its async
// sub-flows. Every tab keeps its own DOM, so scroll, expanded rows, the drill-down panel and the selected bar are its
// memory; hiding a tab does not tear it down.

import { h, fill } from '../dom.js';
import { createFlowRender } from './flow-render.js';
import { createInside } from './flow-inside-panel.js';
import { messagePanel } from './flow-panel.js';
import { createRegroup } from './flow-regroup.js';
import { publishPanel } from './flow-panel-publish.js';
import { plural, asyncTree } from './flow-async.js';
import { createTabScenario } from './flow-tab-scenario.js';
import { stepByKey } from './flow-steps.js';
import { descBlock, descLine } from './flow-desc.js';
import { descDetails } from './flow-head.js';
import { createWalkView } from './flow-walk-view.js'; import { callStore } from './flow-call-store.js';
import { headBadge } from './incomplete-badge.js';
import { createStorePanel } from './store-panel-wire.js';
import { whySection } from './incomplete-why.js';
import { openBalloon } from './incomplete-balloon.js';
import { traceBlocked } from '../../core/incomplete.js';
import { createStepDetails } from './flow-step-details.js';
import { createTip } from './flow-desc-tip.js';
import { openGenerate } from './flow-desc-dialog.js';
import { flowId } from './flow-sub.js';
import { removedList } from './flow-removed.js';
import { servicesText } from '../../core/external.js';
import { servicesOf } from './flow-marks.js';
import { marksNow } from '../design/marks-store.js';
import { foreignNote, maxReadOnly } from './flow-xenv-ui.js';
import { createPartial } from './flow-partial.js';
import { createComments } from '../comments/thread.js';
import { createPane } from '../flow-pane/pane.js';
import { docSummary } from '../../core/notes.js'; import { revealFlowDoc } from '../notes/flow-doc-state.js'; import { createNotes } from '../notes/view.js'; import { createFlowDocLink } from '../notes/flow-doc-link.js';
import { createBrackets } from '../brackets/view.js';
import { stepsParam } from '../comments/range.js';
import { plainText } from '../../core/rich-text.js';
import { parseHash } from '../router.js';
import { createActionItems } from '../action-items/section.js';
import { createItemStore } from '../action-items/store.js';
import { flowAnchor } from '../../core/comments.js';
import { createRelations } from './flow-relations.js';
import { state } from '../state.js';
import { envChip, paintEnv } from '../components/env-chip.js';
import { clampRange, fitScale, scaleOf, percentOf, anchorDelta } from './flow-zoom-pure.js';
import { createZoomControl, applyScale, naturalSize, wireWheel } from './flow-zoom.js';
import { caps, onCaps } from './flow-caption-state.js';
import { storeLegend } from './flow-draw-bands.js';
import { moreItems } from './flow-tab-more.js';
import { looseHead } from './flow-bars-pure.js';

const tc = (t, label) => h('span.tc', { class: t, title: label }, label);
const kindOf = (key) => String(key).split(':')[0].replace('amqp-queue', 'amqp');

/**
 * createTabView(data, host, active) -> { el, key, tools (the player, the scenario switch and the incomplete badge: the page's toolbar hosts them), more() (the items of the toolbar's ⋯ menu), flowEdit, about, draw(), save(), restore(), refreshDots(), insideOpen(), clearMessage(), dispose() }
 * host: { env (this tab's: tabs of different envs sit side by side), marks (its marks), desc (its description store), nameOf, traceFor, readOnly (a tab of another env), switchEnv(), opts, panel, flowsEl, traceFor(request), describe(key), openTab(key), openSub(row, origin), openFull(row, origin), openMany(rows, origin),
 *         openEntry(spec), isOpen(row, origin), setFrontier(), isActive(key), desc (the description store), rootOf(key) -> {service, ingress} | null }
 */
export function createTabView(data, host) {
  let { trace, tree } = data; const { key } = data; // 0.38.0: `trace` is the view of the tab's scenario (flow-tab-scenario.js), replaced when the viewer chooses an arm, opens a service or switches detail
  const opts = host.opts, mwOpen = new Set(); // keys of the bars whose long middleware chain is unfolded
  let zoomV = host.zoomOf?.(key) ?? 100, factor = zoomV === 'fit' ? 1 : clampRange(zoomV) / 100; // zoom (0.30.3): a percent or 'fit'; factor: the scale it gives
  let render = null, saved = 0, sqOff = false; // sqOff: a fold was opened in this tab, so Squeeze is off here until it is switched on again
  // Descriptions belong to the flow (service + ingress of its entry point; a sub-flow tab belongs to the flow it came from). A function tab has none.
  const root = host.desc ? host.rootOf(key) : null, services = [...new Set(trace.participants.filter((p) => p.kind === 'service').map((p) => p.label))];
  const generate = (callee) => openGenerate({ env: host.env, root, services, callee, onClose: () => host.desc.refresh(root) });
  const marks = () => host.marks ?? marksNow(); // the marks of this tab's env
  const editing = !host.readOnly && state.mode === 'edit' && !!state.draft; // a tab of another env never edits (the draft is the page env's)
  const flowPen = () => (!editing && root ? host.pen?.button('panel-flow', 'flow', { form: 'flow', service: root.service, ingress: root.ingress, name: host.nameOf?.(root.service, root.ingress) ?? '' }) : null); // View mode (0.31.1): the same form, through the draft step
  const editFlow = () => (editing && host.edit && root ? h('button.btn.sm', { type: 'button', 'data-qa': 'edit-flow', on: { click: (e) => { e.preventDefault(); e.stopPropagation(); host.edit.flow(root.service, root.ingress, host.nameOf?.(root.service, root.ingress) ?? '', trace.start?.fn || null); } } }, 'Edit flow') : flowPen());
  const descs = [];
  const ts = createTabScenario({ data, host, key, editAll: editing, visible: (k) => !!stepByKey(walk.steps(), k), onView: (v) => { const g = body.contains(document.activeElement) ? document.activeElement.dataset?.g : null; trace = v; tree = asyncTree(v.messages); render = null; paintInc(); draw(); stp?.refresh(); host.paintChrome?.(); if (g) body.querySelector(`select[data-g="${CSS.escape(g)}"]`)?.focus({ preventScroll: true }); } });
  trace = ts.view; tree = asyncTree(trace.messages);
  const label = host.describe(key);
  const inc = headBadge({ onOpen: (a) => openWhy(a) }); // #85: the amber badge before the Scenario chip; N is counted over the trace on screen
  const paintInc = () => { const { n, source } = traceBlocked(trace, trace.coverage); inc.update(n, source, trace.start?.service, trace.coverage?.status); };
  paintInc();
  // The flow's description sits under its title, full width and collapsible (0.20.0); a sub-flow tab keeps its one line.
  let flowBox = null, docText = ''; const related = root && data.kind !== 'sub' ? createRelations({ host, root, editing, onCount: (n) => flowBox?.setRelated(n) }) : null; // 0.28.2: typed links to other flows
  flowBox = root && data.kind !== 'sub' ? descDetails(host.desc, root, null, { cls: 'flowhead', docText: () => docText, openDoc: () => { revealFlowDoc(); pane?.show('notes'); }, relations: related, seenKey: `${host.env}/${root.service}/${root.ingress}`, title: 'What this flow is for', onGenerate: () => generate(null), pen: host.pen, summary: [] }) : null; // frame 28: shown in the (i) popover of the tab (flows.js); the title, id, links, Export and the rest of the old title row are the tab, the toolbar and its ⋯ menu
  const subLine = root && data.kind === 'sub' ? descLine(host.desc, root, [`${data.service}:${data.name}`, data.service], { onGenerate: () => generate(data.service) }) : null;
  descs.push(flowBox, subLine);
  // Comments under the description (0.27.0): the flow's own discussion; a sub-flow or function tab has none.
  let comments = null;
  // The step walk: numbered arrows, the bar and the step's description. Step descriptions belong to the flow, so a sub-flow or function tab walks without them.
  const partial = createPartial({ trace: () => trace, editing, onImport: (anchor, source) => host.importRef?.(anchor, source) });
  const noHint = trace.noHandler ? h('div.noh-hint', { role: 'note', 'data-qa': 'no-handler' }, `No handler function. This entry point has no behaviour in ${host.env} yet.`) : null; // #59
  let brackets = null; // comment brackets in the left gutter (0.34.0): made once the walk and the comments exist
  const walk = createWalkView({ calls: callStore(host.env), store: host.desc, messages: () => trace.messages, root: data.kind === 'sub' ? null : root, initial: host.initialStep?.(key) ?? null, sb: () => opts.sb, hl: () => opts.hl, extra: ts.range, zoom: () => factor, readOnly: host.readOnly, onStep: (n) => host.setStep?.(key, n), onRestep: (cols) => render?.restep(cols), onSteps: (st) => partial.update(st), onPick: (n, ev) => brackets?.pick(n, ev) });
  walk.hiddenOf = (k) => ts.scen.hiddenOf(k); // comments, action items and notes on a step this scenario hides say so and offer "Show"
  const stepRoot = data.kind === 'sub' ? null : root, sdet = createStepDetails({ store: host.desc, root: stepRoot, opts }); // 0.30.0: title / description on the arrows (opts.sd)
  const unDesc = stepRoot ? host.desc.watch(stepRoot, () => { if (render && opts.sd !== 'a') draw(); }) : null; // a saved or loaded step text redraws the lane when the arrows show it
  const tip = root ? createTip(host.desc, root) : null;
  // Action items (0.29.0): a section above Comments; they share a store ("Make action item", the events under a comment)
  const items = root && data.kind !== 'sub' ? createItemStore({ env: host.env, anchor: flowAnchor(root.service, root.ingress) }) : null;
  let pane = null; const counts = {}; // 0.34.0: Comments and Action items are tabs of the bottom pane; their hubs bind late (the pane needs the diagram element)
  const hub = (id) => ({ shown: () => !!pane && pane.shown(id), reveal: () => pane?.show(id), set: (d) => { counts[id] = d; pane?.setCount(id, d); }, tools: (n) => pane?.setTools(n), loaded: (has) => pane?.hub(id).loaded(has) });
  const actions = items ? createActionItems({ store: items, walk, pane: hub('actions') }) : null;
  comments = items ? createComments({ env: host.env, root, walk, store: items, pane: hub('comments'), onThread: (list) => brackets?.setComments(list.filter((c) => c.steps && !c.resolved && !c.deleted).map((c) => ({ id: c.id, steps: c.steps, text: plainText(c.body).split('\n')[0].slice(0, 90) }))) }) : null;
  brackets = items ? createBrackets({ walk, factor: () => factor, on: () => !!opts.cb, hl: () => !!opts.hl, open: (ids) => { pane?.show('comments'); items.focusComment(ids[0]); }, create: (a, b) => comments.startRange(a, b) }) : null;
  const gotoStep = (ref) => { const go = () => walk.go(ref.from); if (host.max?.isOn()) { host.max.set(false); requestAnimationFrame(go); } else go(); }; // a step chip in Notes: leave Maximize, scroll to the step and select it
  const dl = createFlowDocLink({ walk, open: (n) => { pane?.show('notes'); requestAnimationFrame(() => notes?.focusCallout(n)); } }); // Unreleased (frame 28f): callout badges on the diagram, the hover outline, a badge opens its callout
  const notes = items ? createNotes({ env: host.env, root, walk, pane: hub('notes'), onStep: gotoStep, onBody: (html) => { dl.onBody(html); docText = html ? docSummary(html) : ''; flowBox?.redraw(); }, onHover: dl.onHover }) : null; items?.refresh();
  const scroller = h('div.seq-scroll');
  const hint = h('span.seq-hint', 'More to the right. Scroll sideways ›');
  const zctl = createZoomControl({ onZoom: (v) => setZoom(v) }); // frame 28: floats on the diagram, bottom left
  const capLegend = storeLegend(), floatLegend = storeLegend(); // the Read / Write legend: at the right of the caption bar, or (caption bar off) a small chip on the diagram; shown when the top lane has data-store arrows
  const wrap = h('div.seq-wrap', scroller, hint, h('div.zfloat', { 'data-qa': 'zoom-float' }, zctl.el), h('div.leg-float', floatLegend));
  const syncLegend = (box) => { const l = box?.querySelector('.store-legend'); if (l) l.hidden = true; const has = !!l; capLegend.hidden = floatLegend.hidden = !has; wrap.classList.toggle('has-legend', has); };
  walk.legendSlot.append(capLegend); capLegend.hidden = floatLegend.hidden = true;
  const body = h('div.flow-body', { role: 'tabpanel', 'aria-label': host.describe(key).tip }, wrap);
  const edge = () => { wrap.classList.toggle('scrolls', scroller.scrollWidth > scroller.clientWidth + 2); wrap.classList.toggle('at-end', scroller.scrollLeft + scroller.clientWidth >= scroller.scrollWidth - 4); };
  scroller.addEventListener('scroll', () => { edge(); tip?.hide(); }, { passive: true });
  let sized = false; // the first time the tab has a width (it is drawn before it is attached, or while hidden), lay the lanes out to fit it
  let lastW = 0, resizeTimer = 0; // Squeeze folds for the width the tab has: a new width folds again (debounced)
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { pane?.refit(); brackets?.refresh(); edge(); loose(); const w = scroller.clientWidth; if (zoomV === 'fit' && w !== lastW && render) recompute(); if (sized && w > 0 && w !== lastW && shared.squeeze()) { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { render?.relane(); edge(); }, 150); } lastW = w; if (!sized && scroller.clientWidth > 0 && render) { sized = true; render.relane(); render.laneBox.style.visibility = ''; edge(); } }) : null;
  ro?.observe(scroller);
  // a side panel was collapsed or expanded: this tab has another width, so its lanes lay themselves out again (a hidden tab does so when it is shown)
  const onLayout = () => { pane?.refit(); if (!render) return; if (scroller.clientWidth > 0) { render.relane(); edge(); } else sized = false; };
  document.addEventListener('fm:layout', onLayout);
  // ---- zoom (0.30.3, #69): the lane SVGs change size, nothing is laid out again; a point under the pointer stays under it ----
  const loose = () => { const sk = scroller.querySelector('.seq-sticky'); scroller.classList.toggle('zoom-loose', !!sk && looseHead({ headH: sk.offsetHeight, viewH: scroller.clientHeight, zoom: factor })); }; // only a huge zoomed head (> 60% of the view, zoom > 1) scrolls away with the diagram; #107: at normal zoom the heads stay pinned
  function recompute() {
    const nat = naturalSize(render?.laneBox), fitS = nat ? fitScale({ ...nat, vw: scroller.clientWidth - (brackets?.width() ?? 0), vh: scroller.clientHeight }) : null;
    factor = scaleOf(zoomV, fitS);
    applyScale(scroller, factor);
    loose();
    zctl.show(percentOf(factor), zoomV === 'fit');
    brackets?.refresh();
    host.onZoomPaint?.(key); edge();
  }
  function setZoom(v, at = null) {
    const before = factor, svg = scroller.querySelector('svg.seq-body'), r0 = svg?.getBoundingClientRect(), vs = scroller.getBoundingClientRect();
    const p = at ?? { x: vs.left + vs.width / 2, y: vs.top + vs.height / 2 }; // buttons and the box zoom around the middle of the view
    zoomV = v === 'fit' ? 'fit' : clampRange(v);
    recompute();
    host.setZoom?.(key, zoomV);
    if (zoomV === 'fit') { scroller.scrollLeft = 0; scroller.scrollTop = 0; return; }
    if (!r0) return;
    const r1 = svg.getBoundingClientRect(), up = scroller; // the diagram scrolls inside its box in Maximize too (#107), so the heads can stay pinned
    scroller.scrollLeft += anchorDelta({ origin0: r0.left, origin1: r1.left, at: p.x, from: before, to: factor });
    up.scrollTop += anchorDelta({ origin0: r0.top, origin1: r1.top, at: p.y, from: before, to: factor });
  }
  const unWheel = wireWheel(body, { get: () => factor, to: (sc, at) => setZoom(sc * 100, at) });
  const select = (bar) => { body.querySelectorAll('.act.selected').forEach((e) => e.classList.remove('selected')); bar?.el?.classList.add('selected'); };
  const inside = createInside(body, { env: host.env, isActive: () => host.isActive(key),
    desc: root ? (bar) => descBlock(host.desc, root, bar.service, { title: `What ${bar.service} does here`, onGenerate: () => generate(bar.service) }) : null,
    onOpen: () => { stp?.clear(); host.panel.close(); host.flowsEl.classList.add('fi-open'); }, onClose: () => { host.flowsEl.classList.remove('fi-open'); select(null); }, onStep: (m) => markArrow(m) });
  function markArrow(m) { // a step in the drill-down marks its arrow
    body.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active'));
    const g = [...body.querySelectorAll('.seq-body')].map((b) => ({ b, k: b.__events?.findIndex((e) => e.msg === m) })).find((x) => x.k >= 0);
    const el = g?.b.querySelector(`[data-e="${g.k}"]`);
    el?.classList.add('active');
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }
  const lookInside = (bar, tr) => { inside.open(bar, tr); };
  let stp = null; // #86 the store panel of this tab (made below, once the walk and the diagram body exist)
  const flash = (g) => { g?.scrollIntoView({ block: 'center', behavior: 'smooth' }); g?.classList.add('flash'); setTimeout(() => g?.classList.remove('flash'), 1600); };
  const ed = editing && host.edit ? host.edit : null; // Edit with a draft: heads, arrows and "+ call" open forms (design/edit-open.js)
  const shared = { ...ts.hooks, host, opts, tip, walk, details: (built) => sdet.forLane(built, trace.messages), editStep: (k) => walk.editKey(k), editHead: ed ? (service) => { ed.head(service); return true; } : null, addCall: ed ? (bar) => ed.addCall(bar.service, bar.msg.target.fn) : null, addInBand: ed ? (key) => ed.addComponent(key) : null, trigger: () => data.trigger, importRef: (anchor, m) => host.importRef?.(anchor, m?.reference?.source), zoom: () => factor, afterLane: (box) => { syncLegend(box); if (box) brackets?.attach(box); stp?.paint(); if (render && zoomV === 'fit') recompute(); }, squeeze: () => opts.squeeze && !sqOff, squeezeOpen: () => { sqOff = true; host.paintChrome?.(); render?.relane(); edge(); walk.reveal(true); }, fit: () => scroller.clientWidth - (brackets?.width() ?? 0), select, lookInside, flash, traceFor: (q) => host.traceFor(ts.scen.isFull() && !q.detail ? { ...q, detail: 'full' } : q), // a sub-flow card follows the tab's External | Full (0.38.0)
    onStore: (c, ev) => stp?.press(c, ev),
    openMessage: (m, g, tr) => { // clicking an arrow opens the message panel (in Edit: its form); one side panel at a time
      stp?.clear();
      body.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active'));
      g.classList.add('active');
      inside.close();
      if (ed?.arrow(m)) return;
      host.flowsEl.classList.add('mp-open');
      host.panel.open(...messagePanel(m, tr, host.env, 'full', host.openEntry, marks(), regroup.contextOf(m, g), { stepOf: (r) => walk.steps().find((x) => x.event.msg === tr.messages.filter((y) => !y.unfoldOf)[r - 1])?.n ?? r, jump: (n) => { host.panel.close(); walk.go(n); }, expandHere: async (k) => { host.panel.close(); await ts.scen.expandHere(k); requestAnimationFrame(() => { const st = walk.steps().find((x) => x.key === k); if (st) walk.go(st.n); }); } /* 0.44.0 QA: land on the step it opened, not the Simple step number */, foldBack: (k) => { host.panel.close(); ts.scen.foldBack(k); }, unfolded: ts.hooks.unfolded, seenIn: ts.scen.externalSteps, openExternal: () => ts.scen.setDetail('external') }));
    } };
  const regroup = createRegroup({ scen: ts.scen, walk, body, host, trace: () => trace, openMessage: (m, g, tr) => shared.openMessage(m, g, tr) }); // #88
  function openPublish(pub, g, tr) { // the shared trunk of a fan-out: the publish, then its deliveries (each opens its own arrow)
    stp?.clear();
    body.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active'));
    g.classList.add('active');
    inside.close();
    host.flowsEl.classList.add('mp-open');
    const events = g.closest('svg')?.__events ?? [];
    host.panel.open(...publishPanel(pub, (d) => { const k = events.indexOf(d.hop), el = k >= 0 ? g.closest('svg').querySelector(`[data-e="${k}"]`) : g; shared.openMessage(d.msg, el ?? g, tr); }, host.env));
  }
  shared.openPublish = openPublish;
  let whyBal = null;
  function openWhy(anchor) { // #85/#113: the header badge opens the "Why incomplete" balloon under itself (a second press closes it); no pane, no box
    if (whyBal) { whyBal.close(); return; }
    const sec = whySection(trace); if (!sec || !anchor) return;
    whyBal = openBalloon({ content: sec, anchor, onClose: () => { whyBal = null; anchor.setAttribute('aria-expanded', 'false'); } });
    anchor.setAttribute('aria-expanded', 'true');
  }
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
    if (render) { render.relane(); fill(scroller, head(), noHint, render.laneBox, removedList(marks(), servicesOf(trace), { draft: host.readOnly ? null : state.draft, env: host.env }), render.idxBox); } else {
      render = createFlowRender({ trace, tree, key, ancestors: data.start ? [flowId(data.start)] : [] }, shared);
      if (!scroller.clientWidth) render.laneBox.style.visibility = 'hidden'; // drawn before it has a width: show it once laid out to fit
      fill(scroller, head(), noHint, render.laneBox, removedList(marks(), servicesOf(trace), { draft: host.readOnly ? null : state.draft, env: host.env }), render.idxBox);
    }
    recompute(); requestAnimationFrame(edge);
  }
  function infoText() { const extNames = trace.participants.filter((x) => x.external).map((x) => x.service), services = new Set([...trace.messages.map((m) => m.service).filter(Boolean), ...extNames]); return `${trace.start.event ? `${trace.start.event}: ` : ''}${ts.counts(trace, walk.steps().length || null) || plural(trace.messages.length, 'step')}, ${servicesText(services.size - extNames.length, extNames.length)}${trace.truncated ? ', truncated' : ''}`; }
  draw();
  stp = createStorePanel({ body, host, trace: () => ts.scen.ungrouped?.() ?? trace, walk, label: () => label.title, inside, isActive: () => host.isActive(key), onKey: (v) => host.setStore?.(key, v) });
  const back = host.backOf?.(key) ?? null; // a sub-flow: the way back to the flow it was opened from (also in the maximized bar)
  const backBtn = (cls) => back ? h(`button.btn.sm.back-main${cls}`, { type: 'button', 'data-qa': 'back-to-main', title: `Back to ${back.label}${back.step ? ` (step ${back.step})` : ''}`, on: { click: () => host.goBack(key) } }, h('span', { 'aria-hidden': 'true' }, '←'), ` Back to ${back.label}`) : null;
  const backBar = back ? h('div.backbar', backBtn(''), h('span.backtrail.xs.muted', `${back.label} › ${label.title}${label.sub ? ` · ${label.sub}` : ''}`)) : null;
  const maxBar = paintEnv(h('div.max-bar', backBtn('.in-max'), envChip(host.env), host.readOnly ? maxReadOnly(host.env, host.switchEnv) : null, h('span.fh-t', (root && host.nameOf?.(root.service, root.ingress)) || label.title), label.sub ? h('span.mono.xs.muted', label.sub) : null), host.env); // shown only while maximized (flow-max.css)
  if (comments) { pane = createPane({ panels: { notes, comments, actions }, diagram: body }); for (const [id, d] of Object.entries(counts)) pane.setCount(id, d); }
  const xnote = host.readOnly ? foreignNote(host.env, host.design, host.switchEnv) : null; // "Viewing <env>. Switch to it to edit."
  const tools = h('div.tb-tab', { on: { keydown: (ev) => walk.onKey(ev) } }, ts.ui.el, inc.el, walk.nav); // frame 28: the page's toolbar hosts these (flows.js): the scenario switch, the incomplete badge, the step player
  const flowEdit = flowBox ? editFlow() : null; // the second pencil of the old title row: Edit flow (a text button in Edit, a pencil in View); the toolbar's ⋯ menu clicks it
  const moreFor = () => moreItems({ flowBox, root, env: host.env, name: (root && host.nameOf?.(root.service, root.ingress)) || label.title, view: () => ts.scen.exportView(), editing, flowEdit, links: trace.start?.links });
  const el = h('div.flow-tab', maxBar, backBar, xnote, h('div.flow-top', partial.el), body, walk.caption, pane?.splitter, pane?.el); // the pane sits under the diagram (0.27.5); the border between them is a drag handle (0.34.0); the caption bar (frame 28) follows the step, under the diagram
  paintInc(); walk.nav.title = infoText(); const unInfo = walk.watch(() => { walk.nav.title = infoText(); }); // the player's tooltip: "2 steps, 1 service"
  const paintLeg = () => wrap.classList.toggle('leg-off', !caps().legend); paintLeg();
  const unCaps = onCaps(() => { paintLeg(); requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('fm:layout'))); }); // the caption bar came or went: the diagram has another height
  el.addEventListener('keydown', (ev) => {
    const text = /^(INPUT|TEXTAREA|SELECT)$/.test(ev.target?.tagName) || ev.target?.isContentEditable || ev.target?.closest?.('.flow-bottom, .fi');
    if (ev.shiftKey && !ev.ctrlKey && !ev.metaKey && !ev.altKey && (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') && opts.cb && brackets && !text) { ev.preventDefault(); brackets.extend(ev.key === 'ArrowRight' ? 1 : -1); return; } // Shift+← → : a range of steps to comment on (0.34.0)
    walk.onKey(ev); // ← → Home End, while focus is in the flow view and not in a text box
  });
  const unBr = brackets ? walk.watch(() => brackets.refresh()) : null; // the current step's band in the gutter follows the walk
  const sp = comments && data.kind !== 'sub' ? stepsParam(parseHash().query) : null; // `steps=4-9`: a link opens the composer with that range attached, in the active tab only
  if (sp) requestAnimationFrame(() => requestAnimationFrame(() => { if (host.isActive(key) && walk.steps().length >= sp.to) comments.startRange(sp.from, sp.to); }));
  return {
    el, key, data, tools, more: moreFor, flowEdit, about: flowBox ? { el: flowBox.el, open: (on) => flowBox.open(on) } : null, setDetail: (id) => ts.scen.setDetail(id), draw, insideOpen: () => inside.isOpen(), dispose: () => { whyBal?.close(false); unCaps(); unInfo(); ts.ui.dispose(); unWheel(); clearTimeout(resizeTimer); document.removeEventListener('fm:layout', onLayout); inside.dispose(); ro?.disconnect(); tip?.dispose(); descs.forEach((d) => d?.dispose()); comments?.dispose(); actions?.dispose(); notes?.dispose(); brackets?.dispose(); unBr?.(); pane?.dispose(); items?.dispose(); related?.dispose(); walk.dispose(); unDesc?.(); },
    refreshBar: () => walk.refreshBar(), refreshHl: () => walk.refreshHl(), refreshBrackets: () => brackets?.refresh(), refreshDots: () => render?.index()?.refresh(),
    step: () => (walk.picked() ? walk.current() || null : null), goStep: (n) => walk.go(n), // the step the viewer is on (when they chose one) / put the walk on a step
    steps: () => walk.steps(), // the steps of the lane (n, from, to, label, transport): the info pane's "In this flow"
    setZoom, zoomScale: () => factor, zoomValue: () => zoomV,
    squeezeOff: () => sqOff, resetSqueeze: () => { sqOff = false; },
    save: () => { saved = scroller.scrollTop; },
    restore: () => { scroller.scrollTop = saved; edge(); requestAnimationFrame(edge); },
    clearMessage: () => { body.querySelectorAll('.msg.active').forEach((e) => e.classList.remove('active')); stp?.clear(true); },
    clearStore: () => stp?.clear(), restoreStore: () => stp?.restore(host.initialStore?.(key) ?? null), // #86
    info: infoText,
    closeInside: () => inside.close(),
  };
}
