// The toolbar pieces of the system map that belong to the levels (0.28.1): the Subsystems | Components | Domains control, and the subsystem level's own bar
// (Rolled-up calls, Abstract links, "+ link" in Edit with a draft, "Subsystem settings").

import { h } from '../dom.js';
import { href, setQuery } from '../router.js';
import { state } from '../state.js';
import { levelLabels, levelParam } from './system-level.js';

/** levelControl(level, subs) -> the .seg; Domains is shown disabled. A click changes `level=` and draws the page again. */
export function levelControl(level, subs) {
  const w = levelLabels(subs.levels), btn = (k) => h('button', { type: 'button', 'data-qa': `level-${k}`, 'aria-pressed': String(level === k), on: { click: () => {
    if (level === k) return;
    setQuery({ level: levelParam(k), sel: null, link: null, line: null, box: null });
    dispatchEvent(new HashChangeEvent('hashchange'));
  } } }, w[k]);
  return h('div.seg', { role: 'group', 'aria-label': 'Level' }, btn('subsystems'), btn('components'), h('button', { type: 'button', disabled: true, title: 'Later', 'data-qa': 'level-domains' }, w.domains));
}

/** The subsystem level's bar: two checks, "+ link" when editing, and the link to the settings page. */
export function subsystemBar({ opts, onToggle, editing, onAddLink, many = false }) {
  const check = (key, label) => h('label.check', h('input', { type: 'checkbox', 'data-qa': `ss-${key}`, checked: opts[key], on: { change: (e) => { opts[key] = e.target.checked; onToggle(); } } }), label);
  return h('div.filter-bar', check('rolled', 'Rolled-up calls'), check('abstract', 'Abstract links'), many ? check('all', 'All lines') : null,
    many ? h('span.small.muted', 'Hover or select a subsystem to see its lines') : null,
    editing ? h('button.btn.sm', { type: 'button', 'data-qa': 'add-link', title: 'Add an abstract link to the draft', on: { click: onAddLink } }, '+ link') : null,
    h('span.spacer'), h('a.small', { href: href(`/envs/${encodeURIComponent(state.env)}/settings`) }, 'Subsystem settings'));
}
