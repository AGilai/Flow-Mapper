// A flow's bottom pane (0.34.0, frame 20): the tab row `Notes · Comments (n) · Action items (open · all)`, "+ Add ▾", the collapse control, and the
// panels. The tab row is outside the scrolling body, so it never scrolls away; under ~600 px the tabs are a select. The active tab is remembered
// per viewer and in the URL (`pane=`). The border to the diagram is the splitter (splitter.js).

import { h } from '../dom.js';
import { setQuery, parseHash } from '../router.js';
import { TABS, TAB_NAMES, paneParam, initialTab, stepTab, countText, primaryLabel } from './pure.js';
import { createSplitter } from './splitter.js';

const KEY = 'flow-mapper.pane-tab';
const read = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
const write = (v) => { try { localStorage.setItem(KEY, v); } catch { /* storage unavailable */ } };
const mq = (q) => (typeof matchMedia === 'function' ? matchMedia(q) : { matches: false, addEventListener() {}, removeEventListener() {} });

/**
 * createPane({ panels: { notes?, comments, actions }, diagram, hasNotes }) -> { el, splitter, show(id), tab(), shown(id), hub(id), setCount(id, data), setTools(node|null), refit(), dispose() }
 * A panel is { el, add?() (the primary button of its tab), onShow?() }. `hub(id)` is what a panel is given: { shown(), reveal(), set(data) }.
 */
export function createPane({ panels, diagram, hasNotes = false }) {
  const ids = TABS.filter((t) => panels[t]);
  let cur = initialTab({ param: paneParam(parseHash().query), comment: parseHash().query.has('comment'), remembered: read(), hasNotes, available: ids });
  const counts = {}, compactQ = mq('(max-width: 680px)');
  const tabBtn = {}, countEl = {}, panelEl = {};
  const list = h('div.pane-tablist', { role: 'tablist', 'aria-label': 'Flow notes, comments and action items' });
  const sel = h('select.pane-sel', { 'aria-label': 'Pane', 'data-qa': 'pane-select', on: { change: () => show(sel.value, { user: true }) } });
  for (const id of ids) {
    countEl[id] = h('small');
    tabBtn[id] = h('button.pane-tab', { type: 'button', role: 'tab', id: `pane-tab-${id}`, 'data-qa': `pane-tab-${id}`, on: { click: () => show(id, { user: true }), keydown: (e) => onKey(e, id) } }, h('span', TAB_NAMES[id]), countEl[id]);
    sel.append(h('option', { value: id }, TAB_NAMES[id]));
    list.append(tabBtn[id]);
  }
  const primary = h('button.pane-addb', { type: 'button', 'data-qa': 'pane-add', on: { click: () => doAdd(cur) } });
  const more = h('button.pane-addm', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', 'aria-label': 'Add a comment or an action item', 'data-qa': 'pane-add-menu', on: { click: (e) => { e.stopPropagation(); toggleMenu(); } } }, '▾');
  const menu = h('div.pane-menu', { role: 'menu', hidden: true });
  for (const [id, label] of [['comments', 'Comment'], ['actions', 'Action item']]) if (panels[id]) menu.append(h('button.pane-mi', { type: 'button', role: 'menuitem', 'data-id': id, on: { click: () => { closeMenu(); doAdd(id); } } }, h('i'), h('b', label)));
  const addGroup = h('div.pane-add', primary, more, menu);
  const fold = h('button.pane-fold', { type: 'button', 'data-qa': 'pane-fold', on: { click: () => { split.toggle(); paint(); } } }, '▾');
  const tools = h('span.pane-tools', addGroup);
  const tabs = h('div.pane-tabs', list, sel, h('span.pane-sp'), tools, fold);
  const body = h('div.pane-body');
  for (const id of ids) { panelEl[id] = h('div.pane-panel', { role: 'tabpanel', 'aria-labelledby': `pane-tab-${id}`, hidden: true }, panels[id].el); body.append(panelEl[id]); }
  const el = h('div.flow-bottom', { 'data-qa': 'pane' }, tabs, body);
  const split = createSplitter({ pane: el, tabs, diagram });

  function onKey(e, id) {
    const to = e.key === 'ArrowRight' ? stepTab(ids, id, 1) : e.key === 'ArrowLeft' ? stepTab(ids, id, -1) : e.key === 'Home' ? ids[0] : e.key === 'End' ? ids[ids.length - 1] : null;
    if (!to) return;
    e.preventDefault(); show(to, { user: true }); tabBtn[to].focus();
  }
  function doAdd(id) { // the primary button and the menu: switch to the tab, then add there
    if (id === 'notes') { show('notes'); panels.notes.add?.(); return; }
    show(id, { user: true }); panels[id]?.add?.();
  }
  const closeMenu = () => { menu.hidden = true; more.setAttribute('aria-expanded', 'false'); document.removeEventListener('click', closeMenu); };
  function toggleMenu() {
    if (!menu.hidden) return closeMenu();
    menu.querySelectorAll('.pane-mi').forEach((b) => { const on = b.dataset.id === cur; b.classList.toggle('on', on); b.querySelector('i').textContent = on ? '✓' : ''; });
    menu.classList.toggle('up', tabs.getBoundingClientRect().bottom + 110 > innerHeight);
    menu.hidden = false; more.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('click', closeMenu), 0);
    menu.querySelector('.pane-mi')?.focus();
  }
  menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); closeMenu(); more.focus(); } });

  /** Paint labels, counts, the selected tab and its panel. */
  function paint() {
    const compact = compactQ.matches;
    for (const id of ids) {
      const on = id === cur, t = countText(id, counts[id], compact);
      tabBtn[id].setAttribute('aria-selected', String(on)); tabBtn[id].tabIndex = on ? 0 : -1;
      countEl[id].textContent = t;
      sel.options[ids.indexOf(id)].textContent = `${TAB_NAMES[id]}${t ? ` ${t}` : ''}`;
      panelEl[id].hidden = !on;
    }
    sel.value = cur;
    primary.textContent = primaryLabel(cur, compact);
    primary.hidden = cur !== 'notes' && !panels[cur]?.add;
    fold.setAttribute('aria-label', split.collapsed() ? 'Expand the pane' : 'Collapse the pane to its tab row');
    fold.setAttribute('aria-expanded', String(!split.collapsed()));
    fold.classList.toggle('up', split.collapsed());
  }
  function show(id, { user = false } = {}) {
    if (!panels[id]) return;
    const changed = id !== cur;
    cur = id; split.expand(); paint();
    if (user) { write(id); if (changed || paneParam(parseHash().query) !== id) setQuery({ pane: id }); }
    panels[id].onShow?.();
    return changed;
  }
  compactQ.addEventListener?.('change', paint);
  paint();
  return {
    el, splitter: split.el, tab: () => cur, show, shown: (id) => id === cur && !split.collapsed(), refit: () => split.apply(), tabs,
    hub: (id) => ({ shown: () => id === cur && !split.collapsed(), reveal: () => show(id), set: (d) => { counts[id] = d; paint(); } }),
    setCount: (id, d) => { counts[id] = d; paint(); },
    /** Replace the right of the tab row (Notes edit: Save / Cancel); null brings "+ Add ▾" back. */
    setTools: (node) => { tools.replaceChildren(node ?? addGroup); },
    dispose: () => { compactQ.removeEventListener?.('change', paint); document.removeEventListener('click', closeMenu); },
  };
}
