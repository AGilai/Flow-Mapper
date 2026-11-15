// Row 2 of the Flows page, the thin toolbar (frame 28): Inside | Full, the active tab's tools (the scenario switch Simple | External | Full, the incomplete badge, the step player
// "‹ Step 2 of 3 ›"), View ▾, the ⋯ menu (Export, Edit flow, links, Full screen), the full-screen button, and at the right end the Harvested chip and View | Edit (design-strip.js).
// Below 760px (L3, flows.js sets the level) Inside | Full and the detail switch are one dropdown. The tab's own pieces come from its view (flow-tab-view.js `tools`, `more()`, `flowEdit`).

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { openMenu } from '../components/context-menu.js';

const SCOPES = [['intra', 'Inside', 'Inside the service'], ['full', 'Full', 'Full flow']];
const DETAILS = [['simple', 'Simple', 'Each external call once, repeats counted, decisions shown together, internal steps hidden'], ['external', 'External', 'Calls between components, database operations and problems. Open a service to see its internal calls.'], ['full', 'Full', 'Every call, inside the services too']];

/** createToolbar({ onScope(id), onDetail(id), more() -> context-menu items of the active tab, max (flow-max.js), view (the View menu's element), extra (nodes before the right end: the Harvested chip, "+ component") }) -> { el, modeSlot, below, setTools(node, ghost), paint({ hasTab, scoped, fixed, scope, detail }) } */
export function createToolbar({ onScope, onDetail, more, max, view, extra = [] }) {
  const seg = h('div.seg.tb-scope', { role: 'group', 'aria-label': 'Scope' }, SCOPES.map(([id, short, long]) => h('button', { type: 'button', 'data-scope': id, 'aria-label': long, title: long, on: { click: () => onScope(id) } }, short)));
  const tools = h('span.tb-tools'), ghost = h('span.tb-ghost', { 'aria-hidden': 'true' }); // ghost: where the tab's "Edit flow" pencil lives, so its menu opens here
  let cur = { scope: 'full', detail: 'simple', scoped: false, fixed: '', hasTab: false };
  const merged = h('button.tb-merge', { type: 'button', 'aria-haspopup': 'menu', 'data-qa': 'scope-detail', title: 'Scope and detail of this flow', on: { click: () => openMerged() } });
  function openMerged() {
    const r = merged.getBoundingClientRect(), mark = (on) => (on ? '✓ ' : ' ');
    openMenu(r.left, r.bottom + 4, 'Scope and detail', [
      ...SCOPES.map(([id, short, long]) => ({ label: `${mark(cur.scope === id)}${short === 'Inside' ? 'Inside the service' : 'Full flow'}`, disabled: !cur.scoped, hint: cur.scoped ? null : cur.fixed || null, onSelect: () => onScope(id) })), 'divider',
      ...DETAILS.map(([id, short, tip]) => ({ label: `${mark(cur.detail === id)}${short}`, hint: tip, onSelect: () => onDetail(id) }))]);
  }
  const moreBtn = h('button.tb-more', { type: 'button', 'aria-haspopup': 'menu', 'data-qa': 'flow-more', 'aria-label': 'More: export, edit flow, full screen', title: 'More: export, edit flow, full screen', on: { click: () => {
    const r = moreBtn.getBoundingClientRect(), items = more() ?? [];
    openMenu(r.left, r.bottom + 4, 'This flow', [...items, ...(items.length ? ['divider'] : []), { label: 'Full screen', icon: 'maximize', hint: 'F', onSelect: () => max.set(true) }]);
  } } }, icon('more'));
  const modeSlot = h('div.tb-mode'), below = h('div.dz-below');
  const el = h('div.seq-toolbar.tb2', { 'data-qa': 'flow-toolbar' }, seg, merged, tools, view, h('span.tb-more-w', moreBtn, ghost), max.button(), h('span.grow'), ...extra.filter(Boolean), modeSlot);
  return {
    el, modeSlot, below,
    setTools(node, edit = null) { if (tools.firstChild !== node) tools.replaceChildren(...(node ? [node] : [])); if (ghost.firstChild !== edit) ghost.replaceChildren(...(edit ? [edit] : [])); },
    paint(s) {
      cur = { ...cur, ...s };
      seg.querySelectorAll('button').forEach((b) => { b.setAttribute('aria-pressed', String(cur.scope === b.dataset.scope)); b.disabled = !cur.scoped; b.title = cur.scoped ? b.getAttribute('aria-label') : cur.fixed; });
      merged.replaceChildren(DETAILS.find(([id]) => id === cur.detail)?.[1] ?? 'Simple', h('span.vm-c', '▾')); merged.disabled = !cur.hasTab;
      moreBtn.disabled = !cur.hasTab;
    },
  };
}
