// Navigation rail with environment picker and app version.

import { h, clear, fill } from '../dom.js';
import { icon, brandMark } from '../icons.js';
import { state, setEnv } from '../state.js';

const LINKS = [
  { path: '/system', label: 'System map', icon: 'system' },
  { path: '/inventory', label: 'Inventory', icon: 'services', also: ['/services', '/stores', '/channels', '/events'] },
  { path: '/flows', label: 'Flows', icon: 'flow' },
  { path: '/health', label: 'Link health', icon: 'health' },
  { path: '/bugs', label: 'Bugs', icon: 'bug' },
];

export function renderRail(rail, activePath, counts = {}) {
  fill(rail, 
    h('a.brand', { href: '#/system' }, brandMark(), h('span.brand-name', 'Flow-Mapper')),
    ...LINKS.map((l) =>
      h('a.nav-link', { href: `#${l.path}`, 'aria-current': [l.path, ...(l.also ?? [])].some((p) => activePath.startsWith(p)) ? 'page' : null },
        icon(l.icon), h('span', l.label), counts[l.path] ? h('span.nav-badge', String(counts[l.path])) : null)),
    h('div.rail-foot',
      h('label', { for: 'env-select' }, 'Environment'),
      h('select.select#env-select', { on: { change: (e) => setEnv(e.target.value) } },
        state.envs.map((e) => h('option', { value: e, selected: e === state.env }, e))),
      h('span.xs.muted', state.version ? `v${state.version}` : '')),
  );
}
