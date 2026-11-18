// #85 / #135: the "N open ends" chip, neutral (no warning colour). A span in a list row (the row is the link), a button in the trace header (it opens the "Why incomplete" balloon).
// The viewer's "Show coverage warnings" switch (View menu, default on) hides both; the Info panel and the balloon still list the open ends.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { caps } from './flow-caption-state.js';
import { badgeText, badgeLabel, listTip, headTip, headText, headLabel } from './incomplete-pure.js';

/** rowBadge(coverage, service) -> span | null: the entry's own service only; nothing for a complete flow, or when the viewer turned coverage warnings off. */
export function rowBadge(coverage, service) {
  const n = coverage?.blocked ?? 0;
  if (!caps().coverage || !(n > 0 || coverage?.status === 'incomplete')) return null;
  return h('span.inc-badge.sm', { title: listTip(n, service), 'aria-label': badgeLabel(n), 'data-qa': 'incomplete-badge' }, icon('info'), badgeText(n));
}

/** headBadge({ onOpen }) -> { el, update(own, called, source, service, status), refresh() }: hidden when the trace has no open end. Without a count it is plain text: there is nothing to list. */
export function headBadge({ onOpen }) {
  const el = h('span.inc-slot', { hidden: true });
  let last = null;
  const api = {
    el,
    update(own, called, source, service, status = null) {
      last = [own, called, source, service, status];
      el.replaceChildren(); el.hidden = !(caps().coverage && (own + called > 0 || status === 'incomplete'));
      if (el.hidden) return;
      el.append(own + called > 0
        ? h('button.inc-badge', { type: 'button', title: headTip(own, called, source, service), 'aria-label': headLabel(own, called), 'aria-haspopup': 'dialog', 'aria-expanded': 'false', 'aria-controls': 'why-balloon', 'data-qa': 'incomplete-badge', on: { click: (e) => { e.preventDefault(); e.stopPropagation(); onOpen(e.currentTarget); } } }, icon('info'), headText(own, called))
        : h('span.inc-badge', { title: 'The harvester reports this flow as not fully traced, but not where.', 'aria-label': badgeLabel(0), 'data-qa': 'incomplete-badge' }, icon('info'), badgeText(0)));
    },
    refresh() { if (last) api.update(...last); },
  };
  return api;
}
