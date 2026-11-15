// The environment pill at the right end of the Flows tab row (frame 28). In a design environment it replaces the strip above the page: one pill (the env colour, its name, who can see it)
// whose menu holds what the strip held: the Published / Private badge and Share, "from prod, Nov 11", Baseline / prod now, and Drafts. A harvested environment gets the plain pill.
// View | Edit and the draft bar are placed by design-strip.js (the toolbar's right end, under the toolbar).

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { paintEnv } from '../components/env-chip.js';
import { visBadge } from '../components/env-badge.js';

/** The pill of a harvested environment: a swatch and the name, no menu. */
export const plainPill = (env = state.env) => paintEnv(h('span.dz-pill.static', { 'data-qa': 'env-pill', title: `${env} is a harvested environment: read-only` }, h('i.env-dot', { 'aria-hidden': 'true' }), h('b', env)), env);

/**
 * designPill({ meta, when, role, items: { share (a node | null), compare (a node), drafts (a button) } }) -> { el, close }
 * The pill is a button; the menu hangs under it, right edges level, inside the window.
 */
export function designPill({ meta, when, items }) {
  let pop = null;
  const vis = meta?.access ? ({ published: 'globe', shared: 'people', private: 'lock' }[meta.access.visibility] ?? null) : null;
  const btn = paintEnv(h('button.dz-pill', { type: 'button', 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'data-qa': 'env-pill', title: `${state.env}: a design environment. Compare, drafts and sharing are in its menu.`, on: { click: () => (pop ? close() : open()) } },
    h('i.env-dot', { 'aria-hidden': 'true' }), h('b', state.env), state.draft ? h('span.dz-d', 'draft') : null, vis ? icon(vis) : null, h('span.dz-pc', '▾')), state.env);
  const away = (e) => { if (pop && !pop.contains(e.target) && !btn.contains(e.target) && !e.target.closest?.('.ctx-menu, dialog, .dz-dialog')) close(); };
  const key = (e) => { if (e.key === 'Escape' && pop) { e.stopPropagation(); close(); btn.focus(); } };
  function open() {
    pop = h('div.dz-pop', { role: 'dialog', 'aria-label': 'Design environment', 'data-qa': 'design-menu' },
      h('div.dz-pop-h', h('span.dz-chip', { title: `${state.env} is a design environment: a copy you can change in drafts` }, 'design'), h('span.mk-meta', `${meta.source ? `from ${meta.source}` : 'blank'}${when ? ', ' + when : ''}`)),
      items.share || vis ? h('div.dz-pop-r', visBadge(meta), items.share) : null,
      h('div.dz-pop-r.col', h('small', 'Compared with'), items.compare),
      items.drafts ? h('div.dz-pop-r', h('small', 'Changes'), items.drafts) : null);
    document.body.append(pop);
    const r = btn.getBoundingClientRect();
    Object.assign(pop.style, { top: `${Math.round(r.bottom + 6)}px`, right: `${Math.max(8, Math.round(innerWidth - r.right))}px` });
    btn.setAttribute('aria-expanded', 'true');
    setTimeout(() => { addEventListener('pointerdown', away, true); addEventListener('keydown', key, true); addEventListener('resize', close); });
  }
  function close() {
    pop?.remove(); pop = null; btn.setAttribute('aria-expanded', 'false');
    removeEventListener('pointerdown', away, true); removeEventListener('keydown', key, true); removeEventListener('resize', close);
  }
  return { el: btn, close };
}
