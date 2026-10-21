// "assumed" (#47): a value the harvester filled by a rule (client default, convention), not read from code.
// A muted badge, never red and never a warning; basis and reason are in the hover title and in the panels.

import { h } from '../dom.js';
import { assumedTitle } from '../../core/assumed.js';

/** `a`: {basis, reason}. The badge beside a value; the title says what it rests on. */
export const assumedBadge = (a) => h('span.pill.assumed', { title: assumedTitle(a) }, 'assumed');

/** One badge for several entries (a key row): the title lists each with the service it came from (`who`). */
export const assumedListBadge = (list) => h('span.pill.assumed', {
  title: list.map((a) => `${a.who ? a.who + ': ' : ''}${a.what === 'detail' ? a.detail : a.what} = ${valueText(a.value)}. ${assumedTitle(a)}`).join('\n') }, 'assumed');

export const valueText = (v) => (typeof v === 'string' ? v : JSON.stringify(v));

/** One line of a panel: `field = value`, the badge, then basis and reason. `a.field` names the field (or `what`). */
export const assumedRow = (a) => h('div.assumed-row',
  h('span.key', `${a.field ?? (a.what === 'detail' ? a.detail : a.what)} = ${valueText(a.value)}`), ' ', assumedBadge(a),
  h('span.small.muted', ` ${a.basis}: ${a.reason}`));

/** A panel row listing several assumed entries (null when there are none). */
export const assumedBlock = (list, label = 'Assumed values') => (list?.length
  ? h('div.ep-pad.stack', { style: { gap: '2px' } }, h('span.ep-label', label), list.map(assumedRow))
  : null);
