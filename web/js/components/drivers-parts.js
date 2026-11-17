// Small parts of the Drivers view (#130, frame 29), shared by the Inventory tab, the drawer and the component page:
// the lag words, component chips, the legend and the unresolved section. Colour is never alone: the text says it.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { href } from '../router.js';
import { servicePath, storeLink } from '../views/inventory-links.js';
import { lagLevel } from '../../core/drivers.js';

export const LAG = ['', 'lag1', 'lag2'];
export const lagWords = (lag) => `${lag} ${lag === 1 ? 'major' : 'majors'} behind`;
const arrow = () => h('svg.dv-arr', { svg: true, viewBox: '0 0 12 12', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, h('path', { svg: true, d: 'M6 2v8M3 7l3 3 3-3' }));

/** "↓ 1 major behind", or "newest major in use" (`base`: show the baseline words), or nothing. */
export function lagMark(lag, base = false) {
  const l = lagLevel(lag);
  return l ? h('span.dv-lag', { class: LAG[l] }, arrow(), lagWords(lag)) : base ? h('span.dv-lag.l0', 'newest major in use') : null;
}

/** A component chip. A click opens the drawer (`open(service)`); a modified click or a middle click goes to the component page. */
export function compChip(service, { res = 0, mixed = false, open, selected = false } = {}) {
  const a = h('a.dv-cm', { href: href(servicePath(service)), class: selected ? 'sel' : '', title: `${service}: drivers across all store types`,
    on: { click: (e) => { if (open && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) { e.preventDefault(); open(service); } } } },
  h('i'), service, res > 1 ? h('small', `${res} res`) : null, mixed ? h('span.mxb', 'mixed') : null);
  return a;
}

export const gapPill = (text) => h('span.dv-pill.unr', text);

/** The legend under the table: what the bars and chips mean. */
export function legend() {
  return h('div.dv-legend', h('div.row', h('span.lbl', 'Highlight'),
    h('span', h('i.sw.lag1'), '1 major behind the newest major in use in this env'), h('span', h('i.sw.lag2'), '2 or more majors behind'),
    h('span.dv-cm.demo', h('i'), 'name', h('span.mxb', 'mixed')), h('span', 'the component carries 2 majors of one package')),
  h('div.s.mu', 'Baseline is the highest major seen in this env, not npm latest. Text always says it; the bar is only a cue.'));
}

const REASON = { lockfile_not_found: 'not in a lockfile', ambiguous_client_path: 'ambiguous client path', no_major_in_version: 'version has no major', version_not_reported: 'version not reported' };
export const reasonText = (r) => REASON[r] ?? String(r).replace(/_/g, ' ');

/** The Unresolved section: always shown when it has entries (open), never a filter. `items`: UnresolvedItem[]; `open(service)`: drawer. */
export function unresolvedSection(items, { open, note } = {}) {
  if (!items.length && !note) return null;
  const body = h('div', { class: 'dv-unr-body' });
  const rows = items.map((u) => h('tr', h('td', compChip(u.service, { open })), h('td', u.store ? storeLink(u.store) : h('span.mu', '—')), h('td.mono', u.field),
    h('td', u.candidates.length ? h('span.dv-cand', u.candidates.map((c) => h('span', c))) : h('span.mu', 'none offered')),
    h('td.dv-why', u.plain ?? '', u.plain ? ' ' : '', h('code', u.reason))));
  body.append(h('table.dv-t.dv-unr', h('thead', h('tr', ['Component', 'Resource', 'Field', 'Candidates', 'Reason'].map((t) => h('th', t)))), h('tbody', rows)));
  const det = h('details.dv-card.dv-unrsec', { open: true, 'data-qa': 'drivers-unresolved' },
    h('summary.dv-sech', icon('info'), h('h3', 'Unresolved'), items.length ? h('span.dv-pill.unr', `${items.length} ${items.length === 1 ? 'entry' : 'entries'}`) : null,
      h('span.s.mu', 'The harvester found a client here but could not tell the driver or version. Not counted in the rows above.'), h('span.grow'), icon('chevdown')), items.length ? body : null);
  if (!items.length) det.append(h('div.dv-pad.s.mu', note));
  return det;
}

/** The line under the filters: unresolved entries the query left out of the result. */
export function outsideLine(items, showAll) {
  if (!items.length) return null;
  const u = items[0];
  return h('div.dv-outside', icon('info'), h('b', `${items.length} unresolved ${items.length === 1 ? 'entry is' : 'entries are'} not in this result: `),
    items.length === 1 ? [compChip(u.service), ' ', u.store ? storeLink(u.store) : null, u.candidates.length ? [' with candidates ', h('span.mono', u.candidates.join(' | '))] : null, '. '] : '',
    h('a', { href: '#', on: { click: (e) => { e.preventDefault(); showAll(); } } }, 'Show unresolved'));
}
