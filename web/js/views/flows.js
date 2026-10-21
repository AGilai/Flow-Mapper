// Flows: every flow is a tab. Pick an entry point on the left (or an async row, a rail badge, "Start a full flow from
// here") and it opens a tab; tabs are equal and closable. Each tab keeps its own diagram, list and drill-down.
// The state (open tabs, active one, closed stack) is pure (flow-tabs-state.js) and mirrored in the URL: tabs= and tab=.

import { loadMarks } from '../design/marks-store.js';
import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
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

// Squeeze (0.20.1): on by default, remembered per viewer; a click on a fold turns it off for that tab only (flow-tab-view.js).
const sqStored = () => { try { return localStorage.getItem('flow-mapper.squeeze') !== '0'; } catch { return true; } };
const sqSave = (on) => { try { localStorage.setItem('flow-mapper.squeeze', on ? '1' : '0'); } catch { /* storage unavailable */ } };

export async function render({ main, query }) {
  await loadMarks(); // the marks of a design environment (sparks on heads and arrows, the removed list)
  const service = query.get('service');
  const opts = { stores: query.get('stores') !== '0', depth: query.get('depth') ?? 'all',
    frontier: query.get('frontier') === '1', squeeze: sqStored() }; // steps the harvester marked as frontier (call trees that reach no sink)
  let S = T.decodeUrl(query);
  let stepParam = decodeStep(query); // `step=`: the walk's step in the active tab; a link opens on it (0.20.0)
  const stepTab = S.active; // ...and only that tab, once
  const views = new Map(), slots = new Map(), stale = new Set();
  let token = 0, disposed = false;

  const points = service
    ? (await api.service(state.env, service)).ingress.map((i) => ({ service, id: i.id, bindKey: i.bindKey, transport: i.transport, handler: i.handler, entryPoint: i.entryPoint }))
    : await api.entryPoints(state.env);
  const counts = new Map((await api.flowCounts(state.env).catch(() => [])).map((c) => [`${c.service}:${c.ingress}`, c]));
  const data = createTabData(state.env, () => opts);
  const desc = createDescStore(state.env);

  const mainPane = h('div.flows-main');
  const rightEl = h('div.flows-right', mainPane); // the message panel is this grid's second column, so it squeezes the diagram
  const panel = createPanel(rightEl, { onClose: () => { flowsEl.classList.remove('mp-open'); views.get(S.active)?.clearMessage(); } });
  const list = createList({ points, counts, service, onPick: (p) => openEntry({ service: p.service, ingress: p.id }),
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
  const toolbar = h('div.seq-toolbar', seg, check('stores', 'Data stores'), frontierCheck, sqCheck, depth, h('span.spacer'),
    h('span.xs.muted', 'Double-click a bar, or right-click it, to look inside'), info);

  // ---- tabs ----
  const strip = createTabStrip({ describe: data.describe, onActivate: (k) => commit(T.activate(S, k)), onClose: (k) => commit(T.closeTab(S, k)),
    onCloseOthers: (k) => commit(T.closeOthers(S, k)), onCloseAll: () => commit(T.closeAll(S)) });
  const empty = h('div.emptyst', h('div.emptyst-i', enterIcon()), h('h3', 'Pick an entry point'),
    h('p.muted', 'Choose one in the list on the left. Every entry point you pick opens in its own tab, next to the others.'));
  mainPane.append(toolbar, strip.el, empty);

  function persist() {
    setQuery({ ...T.encodeUrl(S), ...(S.keys.length ? { service: null } : {}), stores: opts.stores ? null : '0', queues: null, depth: opts.depth === 'all' ? null : opts.depth, frontier: opts.frontier ? '1' : null, step: encodeStep(stepParam) });
  }
  const host = {
    env: state.env, opts, panel, flowsEl, traceFor: data.traceFor, describe: data.describe, desc, rootOf: (k) => T.flowRoot(k), isActive: (k) => S.active === k,
    openTab: (key, o) => commit(T.openTab(S, key, o)),
    openSub: (row, origin) => commit(T.openTab(S, T.subKey(row, origin))),
    openFull: (row, origin) => commit(T.openTab(S, T.fullKey(row.service, row.ingress, origin, row.event))),
    openMany: (rows, origin) => { const keys = rows.map((r) => T.subKey(r, origin)); commit(keys.reduce((s, k) => T.openTab(s, k, { activate: false }), S), { to: keys[0] }); },
    isOpen: (row, origin) => S.keys.includes(T.subKey(row, origin)),
    jumpToLabel: (label) => { const k = S.keys.find((x) => data.peek(x)?.label === label); if (k) commit(T.activate(S, k)); },
    openEntry: (e) => openEntry(e),
    paintChrome: () => paintChrome(),
    initialStep: (k) => (k === stepTab ? stepParam : null),
    setStep: (k, n) => { if (k === S.active) { stepParam = n; persist(); } },
    setFrontier: () => { opts.frontier = true; frontierCheck.querySelector('input').checked = true; persist(); reloadAll(); },
  };
  const openEntry = ({ service: s, ingress, fn, event, scope }) => commit(T.openTab(S, ingress ? T.entryKey(s, ingress, event, scope) : T.fnKey(s, fn, event, scope)));
  function setScope(scope) {
    const to = T.withScope(S.active, scope);
    if (to !== S.active) commit(T.rekey(S, S.active, to));
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
      if (S.active === key) { v.restore(); paintChrome(); }
      strip.render(S);
    }).catch((err) => { if (slots.get(key) === slot) { slot.replaceChildren(h('div.content', h('div.error-box', err.message))); strip.render(S); } });
  }
  function drop(key) { views.get(key)?.dispose(); views.delete(key); slots.get(key)?.remove(); slots.delete(key); stale.delete(key); }

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
    persist(); strip.render(S);
    const my = ++token, act = S.active, v = views.get(act);
    if (v && stale.delete(act)) v.draw();
    if (prev !== act) { stepParam = null; panel.close(); flowsEl.classList.toggle('fi-open', !!v?.insideOpen()); }
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
  return { dispose: () => { disposed = true; removeEventListener('keydown', onKey); strip.closeMenu(); panel.dispose(); views.forEach((v) => v.dispose()); } };
}
