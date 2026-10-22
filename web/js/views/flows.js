// Flows: every flow is a tab. Pick an entry point on the left (or an async row, a rail badge, "Start a full flow from
// here") and it opens a tab; tabs are equal and closable. Each tab keeps its own diagram, list and drill-down.
// The state (open tabs, active one, closed stack) is pure (flow-tabs-state.js) and mirrored in the URL: tabs= and tab=.

import { currentId } from '../users/me.js';
import { loadMarks } from '../design/marks-store.js';
import { boundaryNote } from './flow-boundary.js';
import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { state, isDesign } from '../state.js';
import { metaOf } from '../env-info.js';
import { setQuery, go } from '../router.js';
import { pageHead } from '../components/page.js';
import { createPanel } from '../components/panel.js';
import { resizer } from '../components/resizer.js';
import { createList } from './flow-list.js';
import { createTabStrip, enterIcon } from './flow-tabs.js';
import { createTabData } from './flow-tab-data.js';
import { createTabView } from './flow-tab-view.js';
import { createDescStore } from './flow-desc.js';
import { swap } from './flow-tabs-anim.js';
import * as T from './flow-tabs-state.js';
import { decodeStep, encodeStep } from './flow-walk.js';
import { createBack } from './flow-back.js';
import { setServiceInfo } from '../design/service-info.js';
import { openImport } from '../design/import-panel.js';
import { editOpener, editing } from '../design/edit-open.js';
import { pencils } from '../design/pencil.js';
import { createPane } from '../pane/pane.js';
import { loadSubsystems } from '../design/subsystems-store.js';
import { relCounts } from './flow-relations-pure.js';
import { createMax } from './flow-max.js';
import { maxFromQuery } from './flow-max-pure.js';
import { decodeBar, decodeArrows, encodeBar, encodeArrows, decodeHl, encodeHl, arrowsDefault, BAR_DEFAULT } from './step-details-pure.js';
import { createStepMenu, stored, storedHl } from './step-details-menu.js';
import { decodeZoom, encodeZoom, percentOf } from './flow-zoom-pure.js';
import { createZoomControl } from './flow-zoom.js';
import { decodeHints, encodeHints } from './flow-hints-pure.js';

// Squeeze (0.20.1): on by default, remembered per viewer; a click on a fold turns it off for that tab only (flow-tab-view.js).
const sqStored = () => { try { return localStorage.getItem('flow-mapper.squeeze') !== '0'; } catch { return true; } };
// Group by subsystem (0.28.1, frame 12c): on by default, remembered per viewer; only offered when the environment has subsystems.
const bandStored = () => { try { return localStorage.getItem('flow-mapper.bands') !== '0'; } catch { return true; } };
const bandSave = (on) => { try { localStorage.setItem('flow-mapper.bands', on ? '1' : '0'); } catch { /* storage unavailable */ } };
const sqSave = (on) => { try { localStorage.setItem('flow-mapper.squeeze', on ? '1' : '0'); } catch { /* storage unavailable */ } };

export async function render({ main, query }) {
  const marks = await loadMarks(); // the marks of a design environment (sparks on heads and arrows, the removed list; a mark on each entry point)
  const service = query.get('service');
  const subs = await loadSubsystems(); // the subsystem of each component: bands and grouping over a flow's heads
  const opts = { stores: query.get('stores') !== '0', depth: query.get('depth') ?? 'all',
    frontier: query.get('frontier') === '1', squeeze: sqStored(), bands: bandStored(),
    sb: decodeBar(query) ?? stored('bar', BAR_DEFAULT), sd: decodeArrows(query, arrowsDefault(isDesign())) ?? stored('arrows', arrowsDefault(isDesign())), th: decodeHints(query, isDesign()), hl: decodeHl(query) ?? storedHl() }; // step details (0.30.0): what the step bar and the arrows show; // steps the harvester marked as frontier (call trees that reach no sink)
  let S = T.decodeUrl(query);
  let stepParam = decodeStep(query); // `step=`: the walk's step in the active tab; a link opens on it (0.20.0)
  const stepTab = S.active; // ...and only that tab, once
  const views = new Map(), slots = new Map(), stale = new Set();
  const zooms = new Map(); // zoom per tab (0.30.3): a percent or 'fit'; the URL carries the active tab's
  const zoomParam = decodeZoom(query);
  if (zoomParam != null && S.active) zooms.set(S.active, zoomParam);
  let token = 0, disposed = false;

  const points = service
    ? (await api.service(state.env, service)).ingress.map((i) => ({ service, id: i.id, bindKey: i.bindKey, transport: i.transport, handler: i.handler, entryPoint: i.entryPoint }))
    : await api.entryPoints(state.env);
  const counts = new Map((await api.flowCounts(state.env).catch(() => [])).map((c) => [`${c.service}:${c.ingress}`, c]));
  const cmts = await api.commentCounts(state.env).catch(() => ({})); // comments per flow, for the 💬 count of the list
  const acts = await api.actionCounts(state.env).catch(() => ({})); // open action items per flow, for the list's badge
  const ments = currentId() ? await api.mentionCounts(state.env, currentId()).catch(() => ({})) : {}; // unread @mentions of the signed-in user per flow ("@ n new")
  const relBy = relCounts(isDesign() ? await api.flowRelations(state.env).catch(() => []) : []); // 0.28.2: relations per flow, for the list's badge and filter
  const names = new Map((await api.flowNames(state.env).catch(() => [])).map((n) => [`${n.service}/${n.ingress}`, n.name]));
  points.forEach((p) => { p.name ||= names.get(`${p.service}/${p.id}`) ?? ''; });
  const nameOf = (s, i) => names.get(`${s}/${i}`) ?? '';
  const data = createTabData(state.env, () => opts, nameOf);
  const desc = createDescStore(state.env);

  const mainPane = h('div.flows-main');
  const rightEl = h('div.flows-right', mainPane); // the message panel is this grid's second column, so it squeezes the diagram
  const panel = createPanel(rightEl, { onClose: () => { flowsEl.classList.remove('mp-open'); views.get(S.active)?.clearMessage(); setQuery({ sel: null }); }, onLeavePane: () => setQuery({ sel: null }) });
  const svcs = await api.services(state.env).catch(() => []);
  setServiceInfo(svcs);
  const groupOf = new Map(svcs.map((s) => [s.name, s.groupPath ?? '']));
  const list = createList({ env: state.env, points, counts, cmts, acts, ments, relBy, service, groupOf, groups: metaOf(state.envMeta, state.env).groups ?? [], marks, design: isDesign(), query, onPick: (p) => openEntry({ service: p.service, ingress: p.id }),
    onAll: () => go('/flows', { tabs: S.keys.join(',') || null, tab: S.keys.length > 1 ? S.active : null }),
    onCollapse: (c) => flowsEl.classList.toggle('list-c', c) });
  const flowsEl = h('div.flows', list.el, rightEl);
  flowsEl.classList.toggle('list-c', list.collapsed());
  resizer(list.el, { edge: 'right', key: 'flows-list', defaultWidth: 300, label: 'Resize entry point list',
    width: () => list.el.offsetWidth, apply: (px) => flowsEl.style.setProperty('--list-w', `${px}px`) });
  resizer(panel.el, { edge: 'left', key: 'flow-panel', defaultWidth: 380, label: 'Resize flow details',
    width: () => panel.el.offsetWidth, apply: (px) => { panel.el.style.width = `${px}px`; } });
  main.append(pageHead('Flows', service ? `Starting points in ${service}` : `${points.length} entry points in ${state.env}`), h('div.content.flush', flowsEl));

  // ---- toolbar ----
  const info = h('span.small.muted');
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Scope' }, [['intra', 'Inside the service'], ['full', 'Full flow']].map(([id, label]) =>
    h('button', { 'data-scope': id, on: { click: () => setScope(id) } }, label)));
  const check = (key, label, title) => h('label.check', { title }, h('input', { type: 'checkbox', checked: opts[key], on: { change: (e) => { opts[key] = e.target.checked; persist(); views.forEach((v, k) => (k === S.active ? v.draw() : stale.add(k))); } } }), label);
  const frontierCheck = h('label.check', { title: 'Call trees the harvester marked as reaching no sink. Folded into one marker per function by default.' },
    h('input', { type: 'checkbox', checked: opts.frontier, on: { change: (e) => { opts.frontier = e.target.checked; persist(); reloadAll(); } } }), 'Frontier steps');
  const depth = h('select.select', { 'aria-label': 'Depth', on: { change: (e) => { opts.depth = e.target.value; persist(); views.forEach((v, k) => (k === S.active ? v.draw() : stale.add(k))); } } },
    ['all', '1', '2', '3', '4', '6', '8'].map((d) => h('option', { value: d, selected: d === opts.depth }, d === 'all' ? 'All depths' : `Depth ${d}`)));
  const sqCheck = h('label.check', { title: 'When the diagram is wider than the window, fold the lifelines the current step does not need. Click a fold to open it.' },
    h('input', { type: 'checkbox', checked: opts.squeeze, on: { change: (e) => { opts.squeeze = e.target.checked; sqSave(opts.squeeze); views.forEach((v, k) => { v.resetSqueeze(); if (k === S.active) v.draw(); else stale.add(k); }); } } }), 'Squeeze');
  const bandsCheck = subs.assigned ? h('label.check', { title: 'Put the components of one subsystem next to each other and show a band with its name over them' },
    h('input', { type: 'checkbox', 'data-qa': 'group-by-subsystem', checked: opts.bands, on: { change: (e) => { opts.bands = e.target.checked; bandSave(opts.bands); views.forEach((v, k) => (k === S.active ? v.draw() : stale.add(k))); } } }), 'Group by subsystem') : null;
  const thCheck = h('label.check', { title: 'Show the words "transport not decided" on arrows. Off: a small icon (the words are in its tooltip and in the step bar).' },
    h('input', { type: 'checkbox', 'data-qa': 'transport-hints', checked: opts.th, on: { change: (e) => { opts.th = e.target.checked; persist(); views.forEach((v, k) => (k === S.active ? v.draw() : stale.add(k))); } } }), 'Transport hints');
  const zctl = createZoomControl({ onZoom: (v) => views.get(S.active)?.setZoom(v) });
  const stepMenu = createStepMenu({ bar: opts.sb, arrows: opts.sd, hl: opts.hl, dflt: arrowsDefault(isDesign()), onChange: ({ bar, arrows, hl }) => {
    const arrowsMoved = arrows !== opts.sd; opts.sb = bar; opts.sd = arrows; opts.hl = hl; persist();
    views.forEach((v, k) => { v.refreshBar(); v.refreshHl(); if (arrowsMoved) { if (k === S.active) v.draw(); else stale.add(k); } });
  } });
  const toolbar = h('div.seq-toolbar', seg, bandsCheck, check('stores', 'Data stores'), frontierCheck, sqCheck, thCheck, depth, stepMenu.el, zctl.el, h('span.spacer'),
    h('span.xs.muted', 'Double-click a bar, or right-click it, to look inside'), info,
    editing() ? h('button.btn.sm', { type: 'button', 'data-qa': 'add-component', title: 'Add a component to the draft', on: { click: () => host.edit.addComponent() } }, '+ component') : null);

  // ---- tabs ----
  const strip = createTabStrip({ describe: data.describe, onActivate: (k) => commit(T.activate(S, k)), onClose: (k) => commit(T.closeTab(S, k)),
    onCloseOthers: (k) => commit(T.closeOthers(S, k)), onCloseAll: () => commit(T.closeAll(S)) });
  const empty = h('div.emptyst', h('div.emptyst-i', enterIcon()), h('h3', 'Pick an entry point'),
    h('p.muted', 'Choose one in the list on the left. Every entry point you pick opens in its own tab, next to the others.'));
  mainPane.append(toolbar, strip.el, empty);

  function persist() {
    setQuery({ ...T.encodeUrl(S), ...(S.keys.length ? { service: null } : {}), stores: opts.stores ? null : '0', queues: null, depth: opts.depth === 'all' ? null : opts.depth, frontier: opts.frontier ? '1' : null, sb: encodeBar(opts.sb), sd: encodeArrows(opts.sd, arrowsDefault(isDesign())), th: encodeHints(opts.th, isDesign()), hl: encodeHl(opts.hl), zoom: encodeZoom(zooms.get(S.active)), step: encodeStep(stepParam) });
  }
  const max = createMax({ onChange: () => views.get(S.active)?.el.scrollTo?.(0, 0) });
  const host = {
    env: state.env, opts, subs, panel, flowsEl, traceFor: data.traceFor, describe: data.describe, desc, rootOf: (k) => T.flowRoot(k), isActive: (k) => S.active === k,
    openTab: (key, o) => commit(T.openTab(S, key, o)),
    openSub: (row, origin) => back.drill(T.subKey(row, origin)),
    openFull: (row, origin) => back.drill(T.fullKey(row.service, row.ingress, origin, row.event)),
    openMany: (rows, origin) => { const keys = rows.map((r) => T.subKey(r, origin)); keys.forEach((k) => back.note(k, origin)); commit(keys.reduce((s, k) => T.openTab(s, k, { activate: false }), S), { to: keys[0] }); },
    backOf: (k) => back.backOf(k), goBack: (k) => back.goBack(k),
    isOpen: (row, origin) => S.keys.includes(T.subKey(row, origin)),
    jumpToLabel: (label) => { const k = S.keys.find((x) => data.peek(x)?.label === label); if (k) commit(T.activate(S, k)); },
    openEntry: (e) => back.drill(entryOf(e)), openFlow: (e) => openEntry(e), // openEntry: a zoom-in or "open the async flow" (a sub-flow of the active tab); openFlow: a plain jump
    paintChrome: () => paintChrome(),
    importRef: (anchor, source) => openImport({ panel, flowsEl, anchor, source }),
    zoomOf: (k) => zooms.get(k) ?? 100,
    onZoomPaint: (k) => { if (k === S.active) paintZoom(); },
    setZoom: (k, v) => { zooms.set(k, v); if (k === S.active) { persist(); paintZoom(); } },
    nameOf, relType: query.get('relType'), max,
    edit: null, // set below: the form opener (Edit with a draft)
    initialStep: (k) => (back.stepFor(k) ?? (k === stepTab ? stepParam : null)),
    setStep: (k, n) => { if (k === S.active) { stepParam = n; persist(); } },
    setFrontier: () => { opts.frontier = true; frontierCheck.querySelector('input').checked = true; persist(); reloadAll(); },
  };
  if (editing()) host.edit = editOpener(host);
  // The info pane (0.33.0): a lifeline head or a subsystem band opens it (View mode; Edit with a draft: the head opens the form, the head's menu has Show details).
  host.pen = pencils(host); // 0.31.1: the pencils of the flow head; the hint of a harvested page sits under the toolbar
  const pane = createPane(panel, { pen: host.pen, ctx: () => { const root = T.flowRoot(S.active); return { fromFlow: root && { ...root, name: nameOf(root.service, root.ingress), steps: views.get(S.active)?.steps?.() ?? [] } }; }, onSelect: (sel) => { flowsEl.classList.add('mp-open'); setQuery({ sel }); } });
  host.openPane = (target) => pane.show(target);
  host.pane = pane;
  toolbar.after(...[host.pen.hint()].filter(Boolean));
  const entryOf = ({ service: s, ingress, fn, event, scope }) => (ingress ? T.entryKey(s, ingress, event, scope) : T.fnKey(s, fn, event, scope));
  const openEntry = (e) => commit(T.openTab(S, entryOf(e)));
  const back = createBack({ active: () => S.active, has: (k) => S.keys.includes(k), step: () => stepParam, view: (k) => views.get(k), open: (k) => commit(T.openTab(S, k)), persist, setStep: (n) => { stepParam = n; },
    label: (k) => { const r = T.flowRoot(k), o = data.describe(k); return (r && nameOf(r.service, r.ingress)) || (o.tn ? `${o.tn} · ${o.title}` : `${o.title} · ${o.sub}`); } });
  function setScope(scope) {
    const to = T.withScope(S.active, scope);
    if (to !== S.active) { if (zooms.has(S.active)) zooms.set(to, zooms.get(S.active)); commit(T.rekey(S, S.active, to)); } // the zoom goes with the tab
  }

  /** Build the view of a tab (a slot at once, the diagram when its data arrives). */
  function ensure(key) {
    if (slots.has(key)) return;
    const slot = h('div.tab-slot', { hidden: true }, h('div.loading', 'Tracing…'));
    slots.set(key, slot);
    mainPane.insertBefore(slot, empty);
    data.load(key).then((d) => {
      if (disposed || slots.get(key) !== slot) return;
      const v = createTabView(d, host);
      views.set(key, v);
      slot.replaceChildren(v.el);
      if (max.isOn()) max.sync();
      if (S.active === key) { v.restore(); paintChrome(); }
      strip.render(S);
    }).catch((err) => { if (slots.get(key) === slot) { slot.replaceChildren(boundaryNote(err, { editing: state.mode === 'edit' && !!state.draft, onImport: host.importRef }) ?? h('div.content', h('div.error-box', err.message))); strip.render(S); } });
  }
  function drop(key) { views.get(key)?.dispose(); views.delete(key); slots.get(key)?.remove(); slots.delete(key); stale.delete(key); }

  function paintZoom() { const v = views.get(S.active); zctl.show(v ? percentOf(v.zoomScale()) : 100, v?.zoomValue() === 'fit', !!v); }
  function paintChrome() {
    const act = S.active, p = act ? T.parseKey(act) : null, scoped = p && (p.kind === 'entry' || p.kind === 'fn');
    seg.querySelectorAll('button').forEach((b) => {
      b.setAttribute('aria-pressed', String(!!p && (p.kind === 'full' || p.kind === 'sub' ? 'full' : p.scope) === b.dataset.scope));
      b.disabled = !scoped;
      b.title = scoped ? '' : p ? 'Fixed for sub-flows' : '';
    });
    info.textContent = views.get(act)?.info() ?? '';
    sqCheck.querySelector('input').checked = opts.squeeze && !views.get(act)?.squeezeOff();
    list.mark(S);
    paintZoom();
    empty.hidden = !!S.keys.length;
    views.get(act)?.refreshDots();
  }

  /** Move to a new state: build and drop views, update URL and chrome, animate the swap. */
  async function commit(next, { to } = {}) {
    const prev = S.active, added = next.keys.filter((k) => !S.keys.includes(k));
    views.get(prev)?.save();
    S = to ? T.activate(next, to) : next;
    for (const k of [...slots.keys()]) if (!S.keys.includes(k)) drop(k);
    S.keys.forEach(ensure);
    if (!S.keys.length && max.isOn()) max.set(false); // the last tab closed while maximized: nothing left to fill the window
    if (prev !== S.active) stepParam = null; // the step belongs to the tab it was set in: not in the URL of another
    persist(); strip.render(S);
    const my = ++token, act = S.active, v = views.get(act);
    if (v && stale.delete(act)) v.draw();
    if (prev !== act) { panel.close(); flowsEl.classList.toggle('fi-open', !!v?.insideOpen()); }
    paintChrome();
    if (prev !== act && act) {
      await swap(slots.get(prev) ?? null, slots.get(act), { opening: added.length === 1 && added[0] === act && S.keys.length > 1, tabEl: strip.tabEl(act) });
      views.get(act)?.restore();
    }
    if (my === token) slots.forEach((s, k) => { s.hidden = k !== S.active; });
  }
  function reloadAll() { // frontier changed: every trace is stale
    data.clear(); [...slots.keys()].forEach(drop); S.keys.forEach(ensure);
    slots.forEach((s, k) => { s.hidden = k !== S.active; });
  }
  const onKey = (e) => {
    const a = T.keyAction(e);
    if (!a || !document.querySelector('.flows')) return;
    e.preventDefault();
    if (a.type === 'prev' || a.type === 'next') commit(T.step(S, a.type === 'next' ? 1 : -1));
    else if (a.type === 'jump') commit(T.nth(S, a.n));
    else if (a.type === 'close') { if (S.active) commit(T.closeTab(S, S.active)); }
    else commit(T.reopenTab(S));
  };
  addEventListener('keydown', onKey);

  S.keys.forEach(ensure);
  slots.get(S.active)?.removeAttribute('hidden');
  strip.render(S); paintChrome();
  if (S.keys.length) persist(); // old single-flow links become tabs=
  host.pen.resume();
  pane.restore(query);
  if (maxFromQuery(query) && S.keys.length) max.set(true, { fullscreen: false, url: false }); // a link or reload opens maximized (window-filling only)
  return { dispose: () => { disposed = true; removeEventListener('keydown', onKey); max.dispose(); strip.closeMenu(); panel.dispose(); views.forEach((v) => v.dispose()); } };
}
