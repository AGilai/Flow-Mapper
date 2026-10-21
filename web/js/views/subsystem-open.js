// "Open in this design: N abstract links" (0.28.1, under the subsystem level): the links that have not become a call yet, with their state and what is wrong.
// A refined link has left this list: it is part of its rolled-up line.

import { h } from '../dom.js';

/** openList(map, { label, onLink, selected }) -> element or null. */
export function openList(map, { label, onLink, selected = null }) {
  const open = map.abstract.filter((v) => v.state !== 'refined');
  if (!open.length) return null;
  return h('section.ss-open', { 'data-qa': 'ss-open', 'aria-label': 'Open in this design' },
    h('h3', 'Open in this design: ', h('span.muted', `${open.length} abstract ${open.length === 1 ? 'link' : 'links'}`)),
    h('ul.ss-open-list', open.map((v) => h('li', { class: selected === v.id ? 'sel' : '' },
      h('button.btn.ghost.sm', { type: 'button', 'data-qa': 'open-link', on: { click: () => onLink(v) } }, v.name),
      h('span.xs.muted', `${label(v.from.subsystem)}${v.from.service ? ` › ${v.from.service}` : ''} → ${label(v.to.subsystem)}${v.to.service ? ` › ${v.to.service}` : ''}`),
      h('span.pill', { class: v.state === 'broken' ? 'warn' : '' }, v.state),
      v.problems.length ? h('span.xs.ss-prob', v.problems.join('; ')) : null))));
}
