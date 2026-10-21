// The rail's environment picker: one row per environment (name, and "sealed · 55 components" or "design · from prod, Oct 21"),
// then "+ New environment". A listbox: arrows move between rows, Enter or click picks.

import { h } from '../dom.js';
import { state, setEnv } from '../state.js';
import { envLine, metaOf } from '../env-info.js';

export function envPicker() {
  const opts = state.envs.map((name) => {
    const on = name === state.env;
    return h('button.env-opt', { type: 'button', role: 'option', 'aria-selected': String(on), tabindex: on ? 0 : -1, title: `${name}: ${envLine(metaOf(state.envMeta, name))}`, on: { click: () => setEnv(name) } },
      h('b', name), h('small', envLine(metaOf(state.envMeta, name))));
  });
  const list = h('div.env-list', { role: 'listbox', 'aria-label': 'Environment',
    on: { keydown: (e) => {
      const rows = [...list.querySelectorAll('.env-opt')], i = rows.indexOf(document.activeElement);
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' || i < 0) return;
      e.preventDefault();
      const next = rows[Math.max(0, Math.min(rows.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      rows.forEach((r) => { r.tabIndex = r === next ? 0 : -1; });
      next.focus();
    } } },
    opts);
  return h('div.env-pick', list, h('a.env-opt.env-add', { href: '#/envs/new' }, '+ New environment'));
}
