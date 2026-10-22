// The info pane controller (0.33.0, docs/plans/info-pane.md): a right drawer (a bottom sheet at <= 760 px) that lives in a page's panel element.
//   const pane = createPane(panel, { pen, ctx(target) -> extra ctx, onSelect(sel, target), onClose() });
//   pane.show({ kind: 'component', name } | { kind: 'subsystem', key });   // content swaps when another item is picked
//   pane.dismiss();                                                        // a click on empty space: closes unless pinned
// Width 420 px (340..640, remembered per viewer), pin, Esc or the close button always close, `onSelect` writes `sel=` to the URL. Data lives in
// pane-component.js / pane-subsystem.js, the DOM of one pane in pane-frame.js, the rules with no DOM in pane-pure.js.

import { h } from '../dom.js';
import { paneFrame } from './pane-frame.js';
import { createExpanded } from './pane-expanded.js';
import { go, setQuery } from '../router.js';
import { componentSpec } from './pane-component.js';
import { subsystemSpec } from './pane-subsystem.js';
import { WIDTH, SNAPS, clampWidth, isSheet, sheetHeight, nearestSnap, selOf, closesOnClick, parseSel, expandedParam } from './pane-pure.js';

const WKEY = 'flow-mapper.pane-width';
const readWidth = () => { try { return clampWidth(Number(localStorage.getItem(WKEY)) || WIDTH.def, innerWidth); } catch { return WIDTH.def; } };
const writeWidth = (px) => { try { localStorage.setItem(WKEY, String(px)); } catch { /* storage unavailable */ } };
let pinned = false; // kept for the session across selections and pages

const SNAP_LABEL = { peek: 'Peek: header only', half: 'Half height', full: 'Full height' };

export function createPane(panel, host = {}) {
  let width = readWidth(), snap = 'half', token = 0, cur = null, frame = null, lastSpec = null;
  const stack = [], el = panel.el;

  // ---- resize (drawer) ----
  const apply = (px, save = true) => { width = clampWidth(px, innerWidth); if (panel.isPane()) el.style.width = `${width}px`; grip.setAttribute('aria-valuenow', String(width)); if (save) writeWidth(width); };
  const grip = h('div.pane-grip', { role: 'separator', 'aria-orientation': 'vertical', tabindex: 0, 'aria-label': 'Resize details', title: 'Drag to resize, double-click to reset', 'aria-valuemin': WIDTH.min, 'aria-valuemax': WIDTH.max, 'aria-valuenow': width });
  let drag = null;
  grip.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; drag = { x: e.clientX, w: el.offsetWidth }; grip.setPointerCapture(e.pointerId); grip.classList.add('on'); document.body.classList.add('resizing'); e.preventDefault(); });
  grip.addEventListener('pointermove', (e) => { if (drag) apply(drag.w + (drag.x - e.clientX), false); });
  const endDrag = () => { if (!drag) return; drag = null; grip.classList.remove('on'); document.body.classList.remove('resizing'); writeWidth(width); };
  grip.addEventListener('pointerup', endDrag); grip.addEventListener('pointercancel', endDrag);
  grip.addEventListener('dblclick', () => apply(WIDTH.def));
  grip.addEventListener('keydown', (e) => { const d = e.key === 'ArrowLeft' ? 1 : e.key === 'ArrowRight' ? -1 : 0; if (d) { e.preventDefault(); apply(width + d * 16); } });
  el.append(grip);

  // ---- sheet (<= 760 px) ----
  const setSnap = (s, px = null) => { snap = s; el.dataset.snap = s; el.style.setProperty('--sheet-h', `${px ?? sheetHeight(s, innerHeight)}px`); grabber.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.snap === s))); };
  const grabber = h('div.pane-grab', { 'data-qa': 'pane-grab' }, h('i'), h('div.pane-snaps', { role: 'group', 'aria-label': 'Sheet height' }, SNAPS.map((s) => h('button', { type: 'button', 'data-snap': s, title: SNAP_LABEL[s], 'aria-label': SNAP_LABEL[s], on: { click: () => setSnap(s) } }, s === 'peek' ? '—' : s === 'half' ? '▭' : '▢'))));
  let sdrag = null;
  grabber.addEventListener('pointerdown', (e) => { if (e.target.closest('button') || !isSheet(innerWidth)) return; sdrag = true; grabber.setPointerCapture(e.pointerId); e.preventDefault(); });
  grabber.addEventListener('pointermove', (e) => { if (sdrag) el.style.setProperty('--sheet-h', `${Math.max(80, Math.min(innerHeight * 0.95, innerHeight - e.clientY))}px`); });
  const endSheet = (e) => { if (!sdrag) return; sdrag = false; setSnap(nearestSnap(innerHeight - e.clientY, innerHeight)); };
  grabber.addEventListener('pointerup', endSheet); grabber.addEventListener('pointercancel', () => { sdrag = false; setSnap(snap); });
  const onResize = () => { if (panel.isPane()) { apply(width, false); if (isSheet(innerWidth)) setSnap(snap); } };
  addEventListener('resize', onResize);

  // ---- content ----
  const ctxFor = (target) => ({
    pen: host.pen, ...(host.ctx?.(target) ?? {}),
    onSub: (key) => show({ kind: 'subsystem', key }, { push: true }), onComponent: (name) => show({ kind: 'component', name }, { push: true }),
  });
  // ---- expanded (frame 19h): the same item as a full-screen page; `expanded=1` in the URL ----
  const showOnMap = (t) => { if (host.showOnMap) host.showOnMap(t); else go('/system', t.kind === 'subsystem' ? { level: 'subsystems', sel: selOf('subsystem', t.key) } : { sel: selOf('component', t.name) }); };
  const expanded = createExpanded({ onCollapse: () => setQuery({ expanded: expandedParam(false) }), onClose: () => close(), onShowOnMap: showOnMap });
  function expand() { if (!lastSpec) return; setQuery({ expanded: expandedParam(true) }); expanded.open(lastSpec); }
  const onPaneKey = (e) => { if ((e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.altKey && !e.target.closest?.('input, textarea, select, [contenteditable]') && panel.isPane() && !expanded.isOpen()) { e.preventDefault(); expand(); } };
  el.addEventListener('keydown', onPaneKey);

  function close() { token++; cur = null; frame = null; lastSpec = null; stack.length = 0; expanded.collapse(false); panel.close(); }
  function back() { const prev = stack.pop(); if (prev) show(prev); }

  async function show(target, { push = false } = {}) {
    const mine = ++token;
    if (push && cur) stack.push(cur); else if (!push && !host.keepStack) stack.length = 0;
    cur = target;
    if (!panel.isPane()) { panel.openPane([grabber, h('p.pane-loading', 'Loading…')], width); if (isSheet(innerWidth)) setSnap(snap); }
    let spec = null;
    try { spec = target.kind === 'subsystem' ? await subsystemSpec(target.key, ctxFor(target)) : await componentSpec(target.name, ctxFor(target)); } catch { spec = null; }
    if (mine !== token) return;
    if (!spec) { panel.openPane([grabber, h('div.pane-root', h('p.pane-none', { style: { padding: 'var(--s4)' } }, `Nothing to show for ${target.kind === 'subsystem' ? 'this subsystem' : target.name}.`), h('button.btn', { type: 'button', on: { click: close } }, 'Close'))], width); return; }
    frame = paneFrame({ ...spec, tools: { edit: spec.edit?.() ?? null, expand, back: stack.length ? back : null, pinned, onPin: (on) => { pinned = on; }, onClose: close } });
    lastSpec = spec;
    panel.openPane([grabber, frame.root], width);
    if (isSheet(innerWidth)) setSnap(snap);
    if (expanded.isOpen()) expanded.update(spec);
    host.onSelect?.(target.kind === 'subsystem' ? selOf('subsystem', target.key) : selOf('component', target.name), target);
  }

  return {
    show, close, back, expand, collapse: () => expanded.collapse(), expanded: () => expanded.isOpen(),
    /** Open what the URL names: `sel=` (and `expanded=1`). Returns whether a selection was found. */
    async restore(query) {
      const want = parseSel(query.get('sel'));
      if (!want) return false;
      await show(want);
      if (query.get('expanded') === '1' && lastSpec) expand();
      return true;
    },
    /** A click on empty space: closes the pane unless it is pinned. Returns whether it closed. */
    dismiss(opts = {}) { if (!panel.isPane() || !closesOnClick({ pinned, onItem: false, insidePane: false, ...opts })) return false; close(); return true; },
    current: () => cur, frame: () => frame, pinned: () => pinned, active: () => panel.isPane() && panel.isOpen(),
    dispose: () => { removeEventListener('resize', onResize); expanded.collapse(false, true); },
  };
}
