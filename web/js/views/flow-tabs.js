// The tab row (row 1 of the Flows page, frame 28): an ARIA tablist (arrows, Home/End, Delete) that never wraps and never scrolls. What does not fit folds into "N more"
// (flow-tabs-menu.js); the active tab always stays in the row. Shrink order: the active tab drops its entry id (L1), inactive tabs show the name (a service with
// several tabs keeps a short id tail), the rest goes into the menu. The active tab has a pencil (rename in place) and an (i) (About this flow).
// It draws what it is given; the state lives in flows.js. Plan and levels: flow-levels.js.

import { h, fill } from '../dom.js';
import { TAB_CAP } from './flow-tabs-state.js';
import { activeShowsId, shortTail, sharedTitles, planTabs, moreLabel } from './flow-levels.js';
import { createMoreMenu } from './flow-tabs-menu.js';
import { flowDoc, setFlowDoc, onFlowDoc } from '../notes/flow-doc-state.js';

const ENTER = 'M2 8h8 M7 5l3 3-3 3 M12 3v10', FULL = 'M8 2v9 M4 8l4 4 4-4 M3 14h10', X = 'M4 4l8 8 M12 4l-8 8';
const NOTE = 'M3.500 2.500h9v11h-9z M5.500 6h5 M5.500 8.500h5 M5.500 11h3', PEN = 'M3 13h2.5L13 5.500 10.500 3 3 10.500z', INFO = 'M8 7.200v4.300 M8 4.600h.01 M8 14A6 6 0 1 1 8 2a6 6 0 0 1 0 12z';
export const enterIcon = () => svg(ENTER);
const svg = (d) => h('svg', { viewBox: '0 0 16 16', html: `<path d="${d}"/>`, 'aria-hidden': 'true' });

/**
 * createTabStrip({ end (a node at the right end: the design / env pill), describe(key), chip(key) -> short env text | null (only while the open tabs span 2+ envs), envVars(key) -> {--ec, --ei},
 *   renameOf(key) -> the flow's name ('' = unnamed) | null (no rename), onRename(key, name), aboutOf(key) -> bool, onAbout(key, button),
 *   docOf(key) -> bool (the tab has a flow doc: the note icon on the active tab shows / hides it; Unreleased, frame 28a),
 *   onActivate(key), onClose(key), onCloseOthers(key), onCloseAll() }) -> { el, render(state), setLevel(n), fit(), tabEl(key), focusActive(), closeMenu() }
 */
export function createTabStrip(cb) {
  let state = { keys: [], active: null }, level = 0, visible = new Set();
  const scroll = h('div.tabscroll', { role: 'tablist', 'aria-label': 'Open flows' });
  const menuBtn = h('button.tabmenu', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'data-qa': 'tab-more', on: { click: () => menu.toggle() } });
  const el = h('div.ftabs', scroll, menuBtn, cb.end ?? null);
  const envChip = (key) => (cb.chip?.(key) ? h('span.tenv', { title: `Environment ${cb.chip(key)}` }, cb.chip(key)) : null);
  // --tc is the transport hue (glyph, .tn); --ec is the env colour (top bar, border) of the tab's own env (0.36.0).
  const withColor = (e, c, key) => { e.style.setProperty('--tc', c); for (const [k, v] of Object.entries(cb.envVars?.(key) ?? {})) e.style.setProperty(k, v); return e; };
  const menu = createMoreMenu({ anchor: el, button: menuBtn, paint: withColor, onPick: (k) => cb.onActivate(k), onClose: (k) => cb.onClose(k), onCloseOthers: () => cb.onCloseOthers(state.active), onCloseAll: () => cb.onCloseAll(),
    rows: () => state.keys.filter((k) => !visible.has(k)).map((k) => { const d = cb.describe(k); return { key: k, title: d.title, sub: d.sub, tn: d.tn, color: d.color, chip: envChip(k) }; }) });

  const iconBtn = (cls, label, d, click) => h(`button.${cls}`, { type: 'button', tabIndex: -1, 'aria-label': label, title: label, on: { click: (e) => { e.stopPropagation(); click(e); } } }, svg(d));
  function rename(key, tab) { // in place: Enter saves, Esc cancels, an empty name removes it
    const b = tab.querySelector('.tl b'), name = cb.renameOf(key) ?? '';
    if (!b || tab.querySelector('.tl input')) return;
    const input = h('input.input.tab-name', { type: 'text', value: name, maxLength: 200, 'aria-label': 'Flow name', placeholder: 'Name this flow', 'data-qa': 'flow-name-input' });
    let done = false;
    const end = (save) => { if (done) return; done = true; if (save && input.value.trim() !== name) cb.onRename(key, input.value.trim()); else render(state); queueMicrotask(() => tabEl(key)?.focus()); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); end(true); } else if (e.key === 'Escape') { e.preventDefault(); end(false); } });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    input.addEventListener('click', (e) => e.stopPropagation()); input.addEventListener('dblclick', (e) => e.stopPropagation());
    input.addEventListener('blur', () => end(true));
    b.replaceWith(input); tab.classList.add('renaming'); input.focus(); input.select();
  }
  const tabFor = (key, shared) => {
    const d = cb.describe(key), on = key === state.active, many = state.keys.length;
    const tail = on ? (activeShowsId(level, many) ? d.sub : null) : d.sub && (shared.has(d.title) || d.tn) ? (d.tn ? null : shortTail(d.sub)) : null;
    const canRename = on && cb.renameOf?.(key) != null, canAbout = on && cb.aboutOf?.(key), canDoc = on && flowDoc().enabled && cb.docOf?.(key), fd = flowDoc().shown;
    // a click on the active tab does nothing: re-rendering it between the two clicks of a double click would swallow the rename gesture
    const t = h('div.tab', { role: 'tab', tabIndex: on ? 0 : -1, 'aria-selected': String(on), title: d.tip, class: `${on ? 'on' : ''} ${d.kind}${d.gone ? ' gone' : ''}`, 'data-key': key,
      on: { click: (e) => { if (!e.target.closest('.x, .tb-act, input') && key !== state.active) cb.onActivate(key); }, auxclick: (e) => { if (e.button === 1) { e.preventDefault(); cb.onClose(key); } }, mousedown: (e) => { if (e.button === 1) e.preventDefault(); },
        dblclick: (e) => { if (canRename && e.target.closest('.tl')) rename(key, t); } } },
      d.tn ? h('span.tn', d.tn) : svg(d.kind === 'full' ? FULL : ENTER),
      envChip(key),
      h('span.tl', h('b', d.title), tail ? h('i', { title: d.sub }, tail) : null),
      canRename ? iconBtn('tb-act.tb-pen', cb.renameOf(key) ? 'Rename this flow' : 'Name this flow', PEN, () => rename(key, t)) : null,
      canAbout ? iconBtn('tb-act.tb-info', 'About this flow', INFO, (e) => cb.onAbout(key, e.currentTarget)) : null,
      canDoc ? Object.assign(iconBtn(`tb-act.tb-fdi${fd ? '.on' : ''}`, fd ? 'Flow doc: hide' : 'Flow doc: show', NOTE, () => setFlowDoc('shown', !flowDoc().shown)), { ariaPressed: String(fd) }) : null,
      h('button.x', { type: 'button', tabIndex: -1, 'aria-label': `Close ${d.title}`, title: 'Close (Alt+W)', on: { click: (e) => { e.stopPropagation(); cb.onClose(key); } } }, svg(X)));
    return withColor(t, d.color, key);
  };
  scroll.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input')) return;
    const i = state.keys.indexOf(e.target.closest?.('.tab')?.dataset.key ?? state.active);
    const to = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: state.keys.length - 1 }[e.key];
    if (to != null) { e.preventDefault(); const k = state.keys[(to + state.keys.length) % state.keys.length]; cb.onActivate(k); queueMicrotask(() => tabEl(k)?.focus()); }
    else if (e.key === 'Delete' && i >= 0) { e.preventDefault(); cb.onClose(state.keys[i]); }
  });
  const tabEl = (key) => [...scroll.children].find((c) => c.dataset.key === key) ?? null;

  /** Show the tabs that fit (the active one always), fold the rest into "N more". Measures the tabs at their natural width, so it runs after every render and resize. */
  function fit() {
    const tabs = [...scroll.children];
    tabs.forEach((t) => { t.hidden = false; });
    menuBtn.hidden = true;
    if (!tabs.length) { visible = new Set(); return; }
    const gap = 2, widths = tabs.map((t) => t.offsetWidth), sum = widths.reduce((s, w) => s + w, 0) + gap * (widths.length - 1);
    let idx = tabs.map((_, i) => i);
    if (sum > scroll.clientWidth + 1) {
      menuBtn.hidden = false; fill(menuBtn, moreLabel(1, level), ' ▾'); // the label's width is the same for every count up to 9
      idx = planTabs({ widths, avail: scroll.clientWidth, active: state.keys.indexOf(state.active), gap });
      const hid = tabs.length - idx.length;
      fill(menuBtn, moreLabel(hid, level), ' ▾');
      const n = state.keys.length;
      menuBtn.classList.toggle('near', n >= TAB_CAP - 2); menuBtn.classList.toggle('full', n >= TAB_CAP);
      menuBtn.title = n >= TAB_CAP ? `${hid} more of ${n} open flows (${TAB_CAP} is the limit)` : `${hid} more open ${hid === 1 ? 'flow' : 'flows'}`;
      menuBtn.hidden = hid < 1;
    }
    visible = new Set(idx.map((i) => state.keys[i]));
    tabs.forEach((t) => { t.hidden = !visible.has(t.dataset.key); });
    if (menu.isOpen()) menu.redraw();
  }
  function render(s) {
    state = s;
    const had = document.activeElement?.closest?.('.tab') ? document.activeElement.closest('.tab').dataset.key : null;
    const shared = sharedTitles(s.keys.map((k) => cb.describe(k).title));
    fill(scroll, s.keys.map((k) => tabFor(k, shared)));
    el.hidden = false;
    fit();
    if (had && tabEl(had) && !tabEl(had).hidden) tabEl(had).focus();
    if (!s.keys.length) menu.close();
  }
  let seen = false; const offDoc = onFlowDoc(() => { if (el.isConnected) { seen = true; render(state); } else if (seen) offDoc(); }); // the note icon follows the flow doc's switches
  if (typeof ResizeObserver === 'function') new ResizeObserver(() => fit()).observe(scroll);
  return { el, render, fit, setLevel(n) { if (n !== level) { level = n; render(state); } }, tabEl, focusActive: () => tabEl(state.active)?.focus(), closeMenu: () => menu.close() };
}
