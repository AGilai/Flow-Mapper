// Frame 35d: a single data-store step has one call, so no card: the query block (the call line and its groups) takes the place of the old "Fields" chips.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { splitStore } from './flow-stores-pure.js';
import { queryBlock, legend } from './query-block.js';

/** queryCard(m, trace, { qm, paramNames }) -> the "Query" section, or null when the step reports no fields. Its fields mark the schema card (qm) at once. */
export function queryCard(m, trace, { qm = null, paramNames = [] } = {}) {
  if (m.kind !== 'resource' || m.dbGroup || !m.fields?.length) return null;
  const at = m.seq ? trace.code?.[`step:${m.service}:${m.fn}#${m.seq}`] : null, loc = at?.file ? `${at.file}${at.line ? `:${at.line}` : ''}` : null;
  const url = /^https?:\/\//i.test(at?.url ?? '') ? at.url : null;
  qm?.set('step', m.fields);
  return h('section.ep-card.qc-step', { 'data-qa': 'step-query' }, h('header', h('h3', 'Query'),
    loc ? h('span.ep-meta', url ? h('a.ep-link-inline', { href: url, target: '_blank', rel: 'noopener noreferrer', title: url }, h('span.key', loc), ' ', icon('external')) : h('span.key', loc)) : null),
    h('div.qc-legend', legend()), h('div.qc-stepb', queryBlock(m.fields, { coll: splitStore(m).collection ?? '', op: m.label === 'use' ? 'call' : m.label, hasParam: (x) => paramNames.includes(x) })));
}
