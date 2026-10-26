// Flows: every flow is a tab. Pick an entry point on the left (or an async row, a rail badge, "Start a full flow from
// here") and it opens a tab; tabs are equal and closable. Each tab keeps its own diagram, list and drill-down.
// The state (open tabs, active one, closed stack) is pure (flow-tabs-state.js) and mirrored in the URL: tabs= and tab=.

import { loadMarks } from '../design/marks-store.js';
import { boundaryNote } from './flow-boundary.js';
import { h, fill, toast } from '../dom.js';
import { api } from '../api.js';
import { state, isDesign, setEnv } from '../state.js';
import { metaOf, envVars } from '../env-info.js';
import { envChip } from '../components/env-chip.js';
import { setQuery, go } from '../router.js';
import { pageHead } from '../components/page.js';
import { createPanel } from '../components/panel.js';
import { resizer } from '../components/resizer.js';
import { createList } from './flow-list.js';
import { createTabStrip, enterIcon } from './flow-tabs.js';
import { createHostFor } from './flow-tab-host.js';
import { createEnvCtx } from './flow-env-ctx.js';
import { loadListData } from './flow-list-data.js';
import { tabChips, goneDescribe } from './flow-xenv.js';
import { unavailableBox } from './flow-xenv-ui.js';
import { createTabView } from './flow-tab-view.js';
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
import { createMax } from './flow-max.js';
import { maxFromQuery } from './flow-max-pure.js';
import { decodeBar, decodeArrows, encodeBar, encodeArrows, decodeHl, encodeHl, decodeCb, encodeCb, arrowsDefault, BAR_DEFAULT } from './step-details-pure.js';
import { createStepMenu, stored, storedHl, storedCb } from './step-details-menu.js';
import { decodeZoom, encodeZoom, percentOf } from './flow-zoom-pure.js';
import { createZoomControl } from './flow-zoom.js';
import { decodeHints, encodeHints } from './flow-hints-pure.js';
import { sqStored, bandStored, bandSave, sqSave, detailStored } from './flow-prefs.js';
import { createScenarios } from './flow-scenario-state.js';

export async function render({ main, query }) {
  const marks = await loadMarks(); // the marks of a design environment (sparks on heads and arrows, the removed list; a mark on each entry point)
  const service = query.get('service');
  const subs = await loadSubsystems(); // the subsystem of each component: bands and grouping over a flow's heads
  const opts = { stores: query.get('stores') !== '0', depth: query.get('depth') ?? 'all',
    frontier: query.get('frontier') === '1', squeeze: sqStored(), bands: bandStored(),
    sb: decodeBar(query) ?? stored('bar', BAR_DEFAULT), sd: decodeArrows(query, arrowsDefault(isDesign())) ?? stored('arrows', arrowsDefault(isDesign())), th: decodeHints(query, isDesign()), hl: decodeHl(query) ?? storedHl(), cb: decodeCb(query) ?? storedCb() ?? isDesign() }; // step details (0.30.0): what the step bar and the arrows show; // steps the harvester marked as frontier (call trees that reach no sink)
  let S = T.decodeUrl(query, state.env); // the tabs of the link, each with its environment (a key without one is the page's)
  const urlCount = T.urlKeys(query, state.env).length; // a link with more tabs than the cap is trimmed (toast below)
  const scen = createScenarios(query, S.active, detailStored); // 0.38.0 (#82): per tab: the arms chosen, External | Full, the services opened; `ch=`, `detail=full`, `open=` of the active tab
  let stepParam = decodeStep(query); // `step=`: the walk's step in the active tab; a link opens on it (0.20.0)
  const stepTab = S.active; let storeParam = query.get('store'); // ...and only that tab, once; #86 `store=`: the store panel of the active tab
  const views = new Map(), slots = new Map(), stale = new Set();
  const zooms = new Map(); // zoom per tab (0.30.3): a percent or 'fit'; the URL carries the active tab's
  const zoomParam = decodeZoom(query);
  if (zoomParam != null && S.active) zooms.set(S.active, zoomParam);
  let token = 0, disposed = false;

  const { points, counts, cmts, acts, ments, relBy, names, svcs } = await loadListData(state.env, service, isDesign());
  setServiceInfo(svcs); setServiceInfo(svcs, state.env);
  const ctxs = createEnvCtx(() => opts); // one context per environment with open tabs (traces, descriptions, names, marks, subsystems): the page's own is seeded
  ctxs.seed(state.env, { names, marks, subs });
  const { data, desc, nameOf } = ctxs.get(state.env);
  const envOfTab = (k) => T.envOfKey(k) ?? state.env, gone = (env) => !state.envs.includes(env); // a tab whose env was deleted (or a link naming one that does not exist) is "unavailable"
  const ctxOf = (k) => (gone(envOfTab(k)) ? null : ctxs.get(envOfTab(k)));

  const mainPane = h('div.flows-main');
  const rightEl = h('div.flows-right', mainPane); // the message panel is this grid's second column, so it squeezes the diagram
  const panel = createPanel(rightEl, { onClose: () => { flowsEl.classList.remove('mp-open'); views.get(S.active)?.clearMessage(); setQuery({ sel: null }); }, onLeavePane: () => setQuery({ sel: null }) });
  const groupOf = new Map(svcs.map((s) => [s.name, s.groupPath ?? '']));
  const list = createList({ env: state.env, points, counts, cmts, acts, ments, relBy, service, groupOf, groups: metaOf(state.envMeta, state.env).groups ?? [], marks, design: isDesign(), query, onPick: (p) => pick(entryOf({ service: p.service, ingress: p.id })), onPickTab: (p) => addTab(entryOf({ service: p.service, ingress: p.id })),
    onAll: () => { const u = T.encodeUrl(S, state.env); go('/flows', { tabs: u.tabs, tab: u.tab }); },
    onCollapse: (c) => flowsEl.classList.toggle('list-c', c) });
  const flowsEl = h('div.flows', list.el, rightEl);
  flowsEl.classList.toggle('list-c', list.collapsed());
  resizer(list.el, { edge: 'right', key: 'flows-list', defaultWidth: 300, label: 'Resize entry point list',
    width: () => list.el.offsetWidth, apply: (px) => flowsEl.style.setProperty('--list-w', `${px}px`) });
  resizer(panel.el, { edge: 'left', key: 'flow-panel', defaultWidth: 380, label: 'Resize flow details',
    width: () => panel.el.offsetWidth, apply: (px) => { panel.el.style.width = `${px}px`; } });
  main.append(pageHead('Flows', service ? `Starting points in ${service}` : h('span', `${points.length} entry points in `, envChip())), h('div.content.flush', flowsEl));

  // ---- toolbar ----
  const info = h('span.small.muted');
  const seg = h('div.seg', { role: 'group', 'aria-label': 'Scope' }, [['intra', 'Inside the service'], ['full', 'Full flow']].map(([id, label]) =>
    h('button', { 'data-scope': id, on: { click: () => setScope(id) } }, label)));
  const check = (key, label, title) => h('label.check', { title }, h('input', { type: 'checkbox', checked: opts[key], on: { change: (e) => { opts[key] = e.target.checked; persist(); views.forEach((v, k) => (k === S.active ? v.draw() : stale.add(k))); } } }), label);
  const frontierCheck = h('label.check', { title: 'Call trees the harvester marked as reaching no sink. Folded into one marker per function by default.' },
    h('input', { type: 'checkbox', checked: opts.frontier, on: { change: (e) => { opts.frontier = e.target.checked; persist(); reloadAll(); } } }), 'Frontier steps');
  const FR_TITLE = frontierCheck.title;
  function syncFrontier() { // 0.44.0 (#90): Simple hides frontier steps, so the checkbox does nothing there
    const simple = !!S.active && scen.of(S.active).detail === 'simple';
    frontierCheck.querySelector('input').disabled = simple; frontierCheck.classList.toggle('disabled', simple); frontierCheck.title = simple ? 'Frontier steps are hidden in Simple' : FR_TITLE;
  }
  const depth = h('select.select', { 'aria-label': 'Depth', on: { change: (e) => { opts.depth = e.target.value; persist(); views.forEach((v, k) => (k === S.active ? v.draw() : stale.add(k))); } } },
    ['all', '1', '2', '3', '4', '6', '8'].map((d) => h('option', { value: d, selected: d === opts.depth }, d === 'all' ? 'All depths' : `Depth ${d}`)));
  const sqCheck = h('label.check', { title: 'When the diagram is wider than the window, fold the lifelines the current step does not need. Click a fold to open it.' },
    h('input', { type: 'checkbox', checked: opts.squeeze, on: { change: (e) => { opts.squeeze = e.target.checked; sqSave(opts.squeeze); views.forEach((v, k) => { v.resetSqueeze(); if (k === S.active) v.draw(); else stale.add(k); }); } } }), 'Squeeze');
  const bandsCheck = subs.assigned ? h('label.check', { title: 'Put the components of one subsystem next to each other and show a band with its name over them' },
    h('input', { type: 'checkbox', 'data-qa': 'group-by-subsystem', checked: opts.bands, on: { change: (e) => { opts.bands = e.target.checked; bandSave(opts.bands); views.forEach((v, k) => (k === S.active ? v.draw() : stale.add(k))); } } }), 'Group by subsystem') : null;
  const thCheck = h('label.check', { title: 'Show the words "transport not decided" on arrows. Off: a small icon (the words are in its tooltip and in the step bar).' },
    h('input', { type: 'checkbox', 'data-qa': 'transport-hints', checked: opts.th, on: { change: (e) => { opts.th = e.target.checked; persist(); views.forEach((v, k) => (k === S.active ? v.draw() : stale.add(k))); } } }), 'Transport hints');
  const zctl = createZoomControl({ onZoom: (v) => views.get(S.active)?.setZoom(v) });
  const stepMenu = createStepMenu({ bar: opts.sb, arrows: opts.sd, hl: opts.hl, cb: opts.cb, dflt: arrowsDefault(isDesign()), onChange: ({ bar, arrows, hl, cb }) => {
    const arrowsMoved = arrows !== opts.sd; opts.sb = bar; opts.sd = arrows; opts.hl = hl; opts.cb = cb; persist();
    views.forEach((v, k) => { v.refreshBar(); v.refreshHl(); v.refreshBrackets(); if (arrowsMoved) { if (k === S.active) v.draw(); else stale.add(k); } });
  } });
  const toolbar = h('div.seq-toolbar', seg, bandsCheck, check('stores', 'Data stores'), frontierCheck, sqCheck, thCheck, depth, stepMenu.el, zctl.el, h('span.spacer'),
    h('span.xs.muted', 'Double-click a bar, or right-click it, to look inside'), info,
    editing() ? h('button.btn.sm', { type: 'button', 'data-qa': 'add-component', title: 'Add a component to the draft', on: { click: () => host.edit.addComponent() } }, '+ component') : null);

  // ---- tabs ----
  let chips = new Map(); // key -> env chip text; empty while the open tabs are of one env
  const strip = createTabStrip({ describe: (k) => ctxOf(k)?.data.describe(k) ?? goneDescribe(k), chip: (k) => chips.get(k) ?? null, onActivate: (k) => commit(T.activate(S, k)), onClose: (k) => commit(T.closeTab(S, k)),
    onCloseOthers: (k) => commit(T.closeOthers(S, k)), onCloseAll: () => commit(T.closeAll(S)), envVars: (k) => (gone(envOfTab(k)) ? { '--ec': 'var(--muted)', '--ei': 'var(--ink-2)' } : envVars(state.envMeta, envOfTab(k))) });
  const renderStrip = () => { chips = tabChips(S.keys); strip.render(S); };
  if (urlCount > T.TAB_CAP) toast(`The link had ${urlCount} tabs. Opened ${T.TAB_CAP}: the limit.`, 5000);
  const empty = h('div.emptyst', h('div.emptyst-i', enterIcon()), h('h3', 'Pick an entry point'),
    h('p.muted', 'Pick a flow in the list. Click opens it here; "Tab" opens it next to the others.'));
  mainPane.append(toolbar, strip.el, empty);

  function persist() {
    syncFrontier();
    setQuery({ ...T.encodeUrl(S, state.env), store: storeParam, ...(S.keys.length ? { service: null } : {}), stores: opts.stores ? null : '0', queues: null, depth: opts.depth === 'all' ? null : opts.depth, frontier: opts.frontier ? '1' : null, sb: encodeBar(opts.sb), sd: encodeArrows(opts.sd, arrowsDefault(isDesign())), th: encodeHints(opts.th, isDesign()), hl: encodeHl(opts.hl), cb: encodeCb(opts.cb, isDesign()), zoom: encodeZoom(zooms.get(S.active)), step: encodeStep(stepParam), ...scen.query(S.active) });
  }
  const max = createMax({ onChange: () => views.get(S.active)?.el.scrollTo?.(0, 0) });
  const host = {
    env: state.env, marks, design: isDesign(), readOnly: false, opts, subs, panel, flowsEl, traceFor: data.traceFor, baseFor: data.baseFor, scen, onScenario: (k) => { if (k === S.active) persist(); }, describe: data.describe, desc, rootOf: (k) => T.flowRoot(k), isActive: (k) => S.active === k,
    openTab: (key, o) => { if (room(key)) commit(T.openTab(S, key, o)); },
    openSub: (row, origin) => { const k = T.subKey(row, origin); if (room(k)) back.drill(k); },
    openFull: (row, origin) => { const k = T.fullKey(row.service, row.ingress, origin, row.event); if (room(k)) back.drill(k); },
    openMany: (rows, origin) => { // up to the cap, in list order; the first new tab comes up
      const { take, skipped, opened } = T.fitKeys(S, rows.map((r) => T.subKey(r, origin)));
      if (!opened) { if (skipped) capToast(); return; }
      take.forEach((k) => back.note(k, origin)); commit(take.reduce((s, k) => T.openTab(s, k, { activate: false }), S), { to: take.find((k) => !S.keys.includes(k)) });
      if (skipped) toast(`Opened ${opened} of ${rows.length}. ${T.TAB_CAP} tabs is the limit, ${skipped} skipped.`, 5000);
    },
    freeSlots: () => T.freeSlots(S),
    backOf: (k) => back.backOf(k), goBack: (k) => back.goBack(k),
    isOpen: (row, origin) => S.keys.includes(T.subKey(row, origin)),
    jumpToLabel: (label) => { const k = S.keys.find((x) => ctxOf(x)?.data.peek(x)?.label === label); if (k) commit(T.activate(S, k)); },
    openEntry: (e) => back.drill(entryOf(e)), openFlow: (e) => openEntry(e), // openEntry: a zoom-in or "open the async flow" (a sub-flow of the active tab); openFlow: a plain jump. A tab of another env gets its own pair (flow-tab-host.js): what it opens is in ITS env
    paintChrome: () => paintChrome(),
    importRef: (anchor, source) => openImport({ panel, flowsEl, anchor, source }),
    zoomOf: (k) => zooms.get(k) ?? 100,
    onZoomPaint: (k) => { if (k === S.active) paintZoom(); },
    setZoom: (k, v) => { zooms.set(k, v); if (k === S.active) { persist(); paintZoom(); } },
    nameOf, relType: query.get('relType'), max,
    edit: null, // set below: the form opener (Edit with a draft)
    initialStep: (k) => (back.stepFor(k) ?? (k === stepTab ? stepParam : null)),
    initialStore: (k) => (k === stepTab ? storeParam : null), setStore: (k, v) => { if (k === S.active) { storeParam = v; persist(); } },
    setStep: (k, n) => { if (k === S.active) { stepParam = n; persist(); } },
    setFrontier: () => { opts.frontier = true; frontierCheck.querySelector('input').checked = true; persist(); reloadAll(); },
  };
  if (editing()) host.edit = editOpener(host);
  // The info pane (0.33.0): a lifeline head or a subsystem band opens it (View mode; Edit with a draft: the head opens the form, the head's menu has Show details).
  host.pen = pencils(host); // 0.31.1: the pencils of the flow head; the hint of a harvested page sits under the toolbar
  const pane = createPane(panel, { pen: host.pen, ctx: (t) => { const root = T.flowRoot(S.active), other = t.env && t.env !== state.env; return { ...(other ? { pen: penRO } : {}), fromFlow: root && { ...root, name: ctxOf(S.active)?.nameOf(root.service, root.ingress) ?? '', steps: views.get(S.active)?.steps?.() ?? [] } }; }, onSelect: (sel, t) => { flowsEl.classList.add('mp-open'); setQuery({ sel: t?.env && t.env !== state.env ? null : sel }); } }); // a component of another env is not in the URL: `sel=` names it in the page's env
  host.openPane = (target) => { views.get(S.active)?.clearStore?.(); pane.show(target); }; host.pane = pane;
  toolbar.after(...[host.pen.hint()].filter(Boolean));
  const { hostFor, penRO } = createHostFor(host, { drillIn: (e, env) => back.drill(entryOf(e, env)), openIn: (e, env) => openEntry(e, env), paneIn: (t, env) => pane.show({ ...t, env }) }); // tabs of other envs (flow-tab-host.js)
  const entryOf = ({ service: s, ingress, fn, event, scope }, env = state.env) => (ingress ? T.entryKey(s, ingress, event, scope, env) : T.fnKey(s, fn, event, scope, env));
  const capToast = () => toast(`You have ${T.TAB_CAP} tabs open. Close some tabs to open another.`, 4500);
  const room = (k) => T.canOpen(S, k) || (capToast(), false); // every opener asks first
  const openEntry = (e, env) => { const k = entryOf(e, env); if (room(k)) commit(T.addTab(S, k)); };
  const addTab = (k) => { if (room(k)) commit(T.addTab(S, k)); }; // the list's "Tab" button
  const pick = (k) => { const next = T.replaceActive(S, k); if (next !== S) { if (S.active && !next.keys.includes(S.active)) zooms.delete(S.active); commit(next); } }; // a plain click: the active tab takes the flow
  const back = createBack({ active: () => S.active, has: (k) => S.keys.includes(k), step: () => stepParam, view: (k) => views.get(k), open: (k) => (room(k) ? commit(T.openTab(S, k)) : Promise.resolve()), persist, setStep: (n) => { stepParam = n; },
    label: (k) => { const r = T.flowRoot(k), c = ctxOf(k), o = c ? c.data.describe(k) : goneDescribe(k); return (r && c?.nameOf(r.service, r.ingress)) || (o.tn ? `${o.tn} · ${o.title}` : `${o.title} · ${o.sub}`); } });
  function setScope(scope) {
    const to = T.withScope(S.active, scope);
    if (to !== S.active) { if (zooms.has(S.active)) zooms.set(to, zooms.get(S.active)); commit(T.rekey(S, S.active, to)); } // the zoom goes with the tab
  }

  /** Build the view of a tab (a slot at once, the diagram when its data arrives). A tab whose env is gone gets a note and no request. */
  function ensure(key) {
    if (slots.has(key)) return;
    const slot = h('div.tab-slot', { hidden: true }, h('div.loading', 'Tracing…'));
    slots.set(key, slot);
    mainPane.insertBefore(slot, empty);
    const ctx = ctxOf(key);
    if (!ctx) { slot.replaceChildren(unavailableBox(envOfTab(key), () => commit(T.closeTab(S, key)))); return; }
    ctx.ready.then(() => ctx.data.load(key, scen.initial(key))).then((d) => {
      if (disposed || slots.get(key) !== slot) return;
      const v = createTabView(d, hostFor(ctx));
      views.set(key, v);
      slot.replaceChildren(v.el);
      if (max.isOn()) max.sync();
      if (S.active === key) { v.restore(); v.restoreStore?.(); paintChrome(); }
      renderStrip();
    }).catch((err) => { if (slots.get(key) === slot) { slot.replaceChildren(boundaryNote(err, { editing: !ctx.foreign && state.mode === 'edit' && !!state.draft, onImport: host.importRef }) ?? h('div.content', h('div.error-box', err.message))); renderStrip(); } });
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
    if (prev !== S.active) { stepParam = null; storeParam = null; } // the step belongs to the tab it was set in: not in the URL of another
    persist(); renderStrip();
    const my = ++token, act = S.active, v = views.get(act);
    if (v && stale.delete(act)) v.draw();
    if (prev !== act) { views.get(prev)?.clearStore?.(); panel.close(); flowsEl.classList.toggle('fi-open', !!v?.insideOpen()); }
    paintChrome();
    if (prev !== act && act) {
      await swap(slots.get(prev) ?? null, slots.get(act), { opening: added.length === 1 && added[0] === act && S.keys.length > 1, tabEl: strip.tabEl(act) });
      views.get(act)?.restore();
    }
    if (my === token) slots.forEach((s, k) => { s.hidden = k !== S.active; });
  }
  function reloadAll() { // frontier changed: every trace is stale
    ctxs.clearData(); [...slots.keys()].forEach(drop); S.keys.forEach(ensure);
    slots.forEach((s, k) => { s.hidden = k !== S.active; });
  }
  const onKey = (e) => {
    const a = T.keyAction(e);
    if (!a || !document.querySelector('.flows')) return;
    e.preventDefault();
    if (a.type === 'prev' || a.type === 'next') commit(T.step(S, a.type === 'next' ? 1 : -1));
    else if (a.type === 'jump') commit(T.nth(S, a.n));
    else if (a.type === 'close') { if (S.active) commit(T.closeTab(S, S.active)); }
    else { const last = S.closed[0]; if (last && !S.keys.includes(last.key) && !T.canOpen(S, last.key)) capToast(); else commit(T.reopenTab(S)); }
  };
  addEventListener('keydown', onKey);

  S.keys.forEach(ensure);
  slots.get(S.active)?.removeAttribute('hidden');
  renderStrip(); paintChrome();
  if (S.keys.length) persist(); // old single-flow links become tabs=
  host.pen.resume();
  pane.restore(query);
  if (maxFromQuery(query) && S.keys.length) max.set(true, { fullscreen: false, url: false }); // a link or reload opens maximized (window-filling only)
  return { dispose: () => { disposed = true; removeEventListener('keydown', onKey); max.dispose(); strip.closeMenu(); panel.dispose(); views.forEach((v) => v.dispose()); } };
}
