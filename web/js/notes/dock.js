// The design doc docked beside the work (Unreleased, frame 28e): on Flows and System map a book icon (the right end of the tab row, or the page's toolbar) opens
// the document in a right column, resizable with a drag grip on its left edge (double-click resets; the width is remembered). Next to the detail pane it is a
// tab: "Design doc | Detail", one column, the other tab's content hidden. Docked or hidden is remembered per viewer and per environment (dock-state.js).
// Hidden is nothing at all: the column is empty and not displayed, the document is not loaded, only the book icon (and the nav entry) remain.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { go } from '../router.js';
import { resizer } from '../components/resizer.js';
import { isDocked, setDocked, onDocked } from './dock-state.js';
import { createDesignDoc } from './design-doc.js';

const tabs = (pick) => {
  const doc = h('button.dk-tab', { type: 'button', role: 'tab', 'data-qa': 'dk-tab-doc', on: { click: () => pick('doc') } }, h('em', 'Design'), 'Design doc');
  const det = h('button.dk-tab', { type: 'button', role: 'tab', 'data-qa': 'dk-tab-detail', on: { click: () => pick('detail') } }, 'Detail');
  const el = h('div.dk-tabs', { role: 'tablist', 'aria-label': 'Right column' }, doc, det);
  return { el, paint: (tab, both, label) => { doc.setAttribute('aria-selected', String(tab === 'doc')); det.setAttribute('aria-selected', String(tab === 'detail')); det.hidden = !both; det.textContent = label ? `Detail · ${label}` : 'Detail'; el.classList.toggle('single', !both); } };
};

/**
 * createDock({ host, env, panel }) -> { el, button, dispose() }
 * host: the element the column is appended to (beside `panel`, the page's detail panel, or null). button: the book icon to put in the page's chrome.
 */
export function createDock({ host, env, panel = null }) {
  const el = h('aside.ddock', { 'aria-label': 'Design doc', 'data-qa': 'design-dock' });
  const button = h('button.ib.dk-btn.bk-btn', { type: 'button', 'data-qa': 'dock-toggle', 'aria-pressed': 'false', title: 'Design doc: dock it beside the work', 'aria-label': 'Design doc: dock it beside the work', on: { click: () => setDocked(env, !isDocked(env)) } }, icon('book'));
  host.append(el);
  let doc = null, tab = 'doc', wasOpen = false;
  const open = () => !!panel && panel.el.classList.contains('open') && !panel.el.classList.contains('is-c');
  const label = () => (panel?.el.querySelector('.panel-strip-t')?.textContent ?? '').trim().slice(0, 26);
  const head = tabs((t) => { tab = t; layout(); }), inPanel = tabs((t) => { tab = t; layout(); });
  inPanel.el.classList.add('dk-tabs-in');

  function build() {
    if (doc) return;
    doc = createDesignDoc({ env });
    const c = doc.controls;
    const hide = h('button.dk-btn', { type: 'button', 'data-qa': 'dk-hide', title: 'Hide the design doc (the book icon brings it back)', 'aria-label': 'Hide the design doc', on: { click: () => setDocked(env, false) } }, icon('close'));
    const page = h('button.dk-btn', { type: 'button', 'data-qa': 'dk-page', title: 'Open as a page', 'aria-label': 'Open the design doc as a page', on: { click: () => go('/design-doc') } }, icon('arrow'));
    el.append(h('div.dk-head', head.el, page, hide), h('div.dk-bar2', c.history, c.meta, c.size, c.tools, c.seg), h('div.dk-body', { 'data-qa': 'dk-body' }, doc.el));
    resizer(el, { edge: 'left', key: 'design-dock', defaultWidth: 460, min: 320, maxFraction: 0.55, label: 'Resize the design doc', width: () => el.offsetWidth, apply: (px) => { el.style.setProperty('--dk-w', `${px}px`); } });
    if (panel && !panel.el.querySelector(':scope > .dk-tabs-in')) panel.el.prepend(inPanel.el);
  }
  function teardown() {
    doc?.dispose(); doc = null; el.replaceChildren(); host.parentElement?.classList.remove('dk-open'); el.classList.remove('open'); el.style.removeProperty('--dk-w');
    panel?.el.classList.remove('dk-away', 'dk-tabbed'); inPanel.el.remove();
    document.dispatchEvent(new CustomEvent('fm:layout'));
  }
  function layout() {
    const docked = isDocked(env);
    button.setAttribute('aria-pressed', String(docked)); button.classList.toggle('on', docked);
    button.title = button.ariaLabel = docked ? 'Design doc: hide it (it is docked beside the work)' : 'Design doc: dock it beside the work';
    if (!docked) { if (doc) teardown(); return; }
    build(); queueMicrotask(() => host.parentElement?.classList.add('dk-open')); // the Flows list steps back to its strip, as for any pane (a microtask: the page starts watching after it made the dock)
    const both = open();
    if (!both) tab = 'doc';
    el.classList.add('open'); el.classList.toggle('dk-away', both && tab === 'detail');
    panel?.el.classList.toggle('dk-away', both && tab === 'doc'); panel?.el.classList.toggle('dk-tabbed', both);
    for (const t of [head, inPanel]) t.paint(tab, both, label());
    document.dispatchEvent(new CustomEvent('fm:layout'));
  }
  // a detail pane that opens while the doc is docked is what the viewer asked for: it becomes the visible tab
  const mo = panel && typeof MutationObserver === 'function' ? new MutationObserver(() => { const o = open(); if (o === wasOpen) return; wasOpen = o; if (o) tab = 'detail'; layout(); }) : null;
  mo?.observe(panel.el, { attributes: true, attributeFilter: ['class'] });
  const off = onDocked((e) => { if (e === env) layout(); });
  layout();
  return { el, button, dispose: () => { off(); mo?.disconnect(); host.parentElement?.classList.remove('dk-open'); doc?.dispose(); doc = null; el.remove(); inPanel.el.remove(); panel?.el.classList.remove('dk-away', 'dk-tabbed'); } };
}
