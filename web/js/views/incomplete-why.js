// #85: the "Why incomplete" section of the info pane: one item per blocked call (plain reason, code, file:line), at most 20, hidden when nothing is blocked.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { blockedSites, traceBlocked } from '../../core/incomplete.js';
import { siteTitle, siteCode, sitePlace, siteGroups } from './incomplete-pure.js';

function item(s, me) {
  const place = sitePlace(s), link = place && (s.url
    ? h('a.inc-src', { href: s.url, target: '_blank', rel: 'noopener', title: s.url }, place, icon('external'))
    : h('span.inc-src.plain', place));
  return h('li.inc-site', { class: me ? 'me' : '', 'data-site': s.id },
    h('div.inc-t', h('b', siteTitle(s)), siteCode(s) ? h('span.inc-rc', siteCode(s)) : null),
    h('code.inc-code', s.call || s.fn), link);
}

/** whySection(trace, { me }) -> section | null. `me`: the step id (`service:fn#seq`) the pane is on; its row is marked and scrolled into view. */
export function whySection(trace, { me = null } = {}) {
  const { n, source } = traceBlocked(trace, trace.coverage);
  if (!(n > 0)) return null;
  const { sites, more } = blockedSites(trace, trace.coverage);
  const intro = source === 'coverage' ? `From the entry point's coverage report (${trace.start?.service} only). Other services on this trace may add more.` : 'These calls could not be followed, so what they reach is not drawn.';
  const el = h('section.inc-why', { id: 'why-incomplete', 'aria-labelledby': 'why-incomplete-h', 'data-qa': 'why-incomplete' },
    h('div.inc-h', icon('warn'), h('h4', { id: 'why-incomplete-h', tabindex: '-1' }, 'Why incomplete'), h('span.inc-n', `${n} blocked`)),
    h('p.xs.inc-intro', intro),
    siteGroups(sites).map((g) => [g.service ? h('div.inc-g', `${g.service} · ${g.sites.length}`) : null, h('ol.inc-list', g.sites.map((s) => item(s, s.id === me)))]),
    more > 0 ? h('p.xs.inc-more', h('b', `+ ${more} more`), ' not listed here.') : null);
  if (me) requestAnimationFrame(() => el.querySelector('.inc-site.me')?.scrollIntoView({ block: 'nearest' }));
  return el;
}

/** The id of the step a message is (`service:fn#seq`), for `me`. */
export const stepIdOf = (m) => m?.blocked?.id ?? (m?.service && m.fn && m.seq ? `${m.service}:${m.fn}#${m.seq}` : null);
