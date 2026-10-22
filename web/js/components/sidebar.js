// Navigation rail with environment picker and app version.

import { h, clear, fill } from '../dom.js';
import { icon, brandMark } from '../icons.js';
import { state, isDesign } from '../state.js';
import { envPicker } from './env-picker.js';
import { userButton } from '../users/user-button.js';
import { KEYS, SLIDE_MS, readCollapsed, writeCollapsed, toggleLabel, envShort } from '../collapse.js';

let collapsed = readCollapsed(KEYS.rail);

/** Tell the pages that the room they have changed once the slide is done (a lane lays itself out to fit). */
export const announceLayout = () => setTimeout(() => document.dispatchEvent(new CustomEvent('fm:layout')), SLIDE_MS + 40);

const LINKS = [
  { path: '/system', label: 'System map', icon: 'system' },
  { path: '/inventory', label: 'Inventory', icon: 'services', also: ['/services', '/stores', '/channels', '/events'] },
  { path: '/flows', label: 'Flows', icon: 'flow' },
  { path: '/mentions', label: 'Mentions', icon: 'at' },
  { path: '/questions', label: 'Questions', icon: 'question', design: true }, // the open questions of the About texts: a design environment's (0.33.0)
  { path: '/health', label: 'Link health', icon: 'health' },
  { path: '/bugs', label: 'Bugs', icon: 'bug' },
  { path: '/users', label: 'Users', icon: 'user' },
];

export function renderRail(rail, activePath, counts = {}) {
  const app = rail.parentElement;
  app?.classList.toggle('rail-c', collapsed);
  const toggle = () => {
    collapsed = writeCollapsed(KEYS.rail, !collapsed);
    app?.classList.toggle('rail-c', collapsed);
    const b = rail.querySelector('.collapse-btn');
    b?.setAttribute('aria-expanded', String(!collapsed)); b?.setAttribute('aria-label', toggleLabel('the sidebar', collapsed)); b?.setAttribute('title', toggleLabel('the sidebar', collapsed));
    announceLayout();
  };
  fill(rail,
    h('div.brand-row',
      h('a.brand', { href: '#/system', title: 'Flow-Mapper', 'aria-label': 'Flow-Mapper' }, brandMark(), h('span.brand-name', 'Flow-Mapper')),
      h('button.collapse-btn', { type: 'button', 'aria-expanded': String(!collapsed), 'aria-controls': 'rail', 'aria-label': toggleLabel('the sidebar', collapsed), title: toggleLabel('the sidebar', collapsed), on: { click: toggle } }, icon('chev'))),
    ...LINKS.filter((l) => !l.design || isDesign()).map((l) =>
      h('a.nav-link', { href: `#${l.path}`, title: l.label, 'aria-label': l.label, 'aria-current': [l.path, ...(l.also ?? [])].some((p) => activePath.startsWith(p)) ? 'page' : null },
        icon(l.icon), h('span.nav-text', l.label), counts[l.path] ? h('span.nav-badge', String(counts[l.path])) : null)),
    h('div.rail-foot',
      h('button.env-chip', { type: 'button', title: `Environment ${state.env}. Click to expand the sidebar and change it.`, 'aria-label': `Environment ${state.env}, expand the sidebar`, on: { click: () => { if (collapsed) toggle(); } } }, envShort(state.env)),
      h('span.env-label', 'Environment'),
      envPicker(),
      userButton(),
      h('span.xs.muted', state.version ? `v${state.version}` : '')),
  );
}
