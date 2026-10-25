// #85: the amber "incomplete · N blocked" badge. A span in a list row (the row is the link), a button in the trace header (it jumps to "Why incomplete").

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { badgeText, badgeLabel, listTip, headTip } from './incomplete-pure.js';

/** rowBadge(coverage, service) -> span | null: the entry's own service only; nothing for a complete flow. */
export function rowBadge(coverage, service) {
  const n = coverage?.blocked ?? 0;
  if (!(n > 0 || coverage?.status === 'incomplete')) return null;
  return h('span.inc-badge.sm', { title: listTip(n, service), 'aria-label': badgeLabel(n), 'data-qa': 'incomplete-badge' }, icon('warn'), badgeText(n));
}

/** headBadge({ onOpen }) -> { el, update(n, source, service, status) }: hidden when the trace is complete. Without a count it is plain text: there is nothing to list. */
export function headBadge({ onOpen }) {
  const el = h('span.inc-slot', { hidden: true });
  return {
    el,
    update(n, source, service, status = null) {
      el.replaceChildren(); el.hidden = !(n > 0 || status === 'incomplete');
      if (el.hidden) return;
      el.append(n > 0
        ? h('button.inc-badge', { type: 'button', title: headTip(n, source, service), 'aria-label': badgeLabel(n, { button: true }), 'aria-controls': 'why-incomplete', 'data-qa': 'incomplete-badge', on: { click: (e) => { e.preventDefault(); e.stopPropagation(); onOpen(); } } }, icon('warn'), badgeText(n))
        : h('span.inc-badge', { title: 'Incomplete flow. The harvester reports it as incomplete but not where.', 'aria-label': badgeLabel(0), 'data-qa': 'incomplete-badge' }, icon('warn'), badgeText(0)));
    },
  };
}
