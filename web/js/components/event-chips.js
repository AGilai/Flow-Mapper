// Event types and subscription filters as chips. Long lists show a few and expand in place.

import { h } from '../dom.js';

export const evChip = (type, cls = '') => h('span.ev-chip', { class: cls }, type);

/** Chips for a list of event types; beyond `limit` a "+N more" button expands the rest. */
export function eventChips(types, { limit = 3, cls = '' } = {}) {
  const wrap = h('span.chips');
  const draw = (all) => wrap.replaceChildren(...[
    ...(all ? types : types.slice(0, limit)).map((t) => evChip(t, cls)),
    !all && types.length > limit
      ? h('button.chip-more', { type: 'button', title: types.slice(limit).join(', '), on: { click: () => draw(true) } }, `+${types.length - limit} more`)
      : null,
  ].filter(Boolean));
  draw(false);
  return wrap;
}

/** A subscription filter: "all events", the accepted names, or "all except x" for '!' entries. */
export function filterChips(events, { limit = 4, cls = '' } = {}) {
  if (events === '*') return h('span.chips', h('span.all-chip', { class: cls }, 'all events'));
  const pos = events.filter((e) => !e.startsWith('!'));
  const neg = events.filter((e) => e.startsWith('!') && e.length > 1).map((e) => e.slice(1));
  return h('span.chips',
    pos.length ? eventChips(pos, { limit, cls }) : null,
    neg.length ? [h('span.all-chip', { class: cls }, pos.length ? 'except' : 'all except'), eventChips(neg, { limit, cls })] : null);
}
