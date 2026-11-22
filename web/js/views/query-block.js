// Frame 35: the query of a data-store call, drawn. `queryBlock(fields, { coll, op })` is the call line plus the groups Filter / Projection / Update / Sort (field | op,
// helper filters badged, "not in schema" kept, an optional "value from" under each field); `summaryLine(fields)` is the collapsed card's one-liner; `legend()` the F P U S key.
// Pure data comes from core/query-card.ts. Everything works without `fields[].value`: no value column, one footer line.

import { h, s } from '../dom.js';
import { icon } from '../icons.js';
import { LETTER, ROLE_NAME, summaryParts, callLine, groups, hasValues, paramName } from '../../core/query-card.js';

/** The letter badge of a role (F, P, U, S). */
export const badge = (role) => h('i.lt', { title: ROLE_NAME[role].toLowerCase() }, LETTER[role]);

export const legend = () => h('span.qc-leg', { 'aria-label': 'Legend', 'data-qa': 'query-legend' },
  ...['filter', 'projection', 'update', 'sort'].flatMap((r, i) => [i ? ' · ' : null, badge(r), ` ${r}`]));

export const chevron = () => s('svg', { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': 'true' }, s('path', { d: 'M3 1.5 7 5 3 8.5', fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));

/** The summary of the collapsed card: per role its badge and up to two names, +N, and "+N implicit" for helper filters. Null when the call reports no fields. */
export function summaryLine(fields) {
  const parts = summaryParts(fields);
  if (!parts.length) return null;
  const only = parts.length === 1 && parts[0].role === 'filter' && !parts[0].names.length; // helper filters only: muted
  return h('div.qc-sum', { class: only ? 'muted' : '', 'data-qa': 'query-summary' }, parts.flatMap((p, i) => [i ? ' ' : null, badge(p.role),
    p.names.join(' '), p.more ? h('i', ` +${p.more}`) : null, p.implicit ? h('i', `${p.names.length ? ' +' : ''}${p.implicit} implicit`) : null]));
}

/** A param value links to its row under Path parameters: scroll to it and flash it. */
function gotoParam(name, from) {
  const pane = from.closest('aside.panel') ?? document;
  const it = [...pane.querySelectorAll('[data-qa=path-params] [data-param]')].find((x) => x.dataset.param === name);
  if (!it) return;
  it.scrollIntoView({ block: 'nearest', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  it.classList.add('qc-flash'); setTimeout(() => it.classList.remove('qc-flash'), 1400);
}

function valueCell(v, hasParam) {
  if (!v) return h('span.nr', 'not reported');
  const link = v.source ? h('a.cl', { href: '#', title: `${v.source.file}${v.source.line ? `:${v.source.line}` : ''}`, 'aria-label': `Code: ${v.source.file}${v.source.line ? ` line ${v.source.line}` : ''}`, on: { click: (e) => e.preventDefault() } }, icon('external')) : null;
  const kd = h(`span.kd.k-${v.kind}`, v.kind);
  if (v.kind === 'const') return [h('span.arrow', '='), h('span.lit', v.from), kd, link];
  const pn = paramName(v);
  const txt = pn && hasParam(pn) ? h('a.pp', { href: '#', title: 'Show in Path parameters', on: { click: (e) => { e.preventDefault(); gotoParam(pn, e.currentTarget); } } }, v.from) : v.from;
  return [h('span.arrow', '←'), txt, kd, link];
}

/**
 * queryBlock(fields, { coll, op, hasParam(name) }) -> the block. `coll`.`op`: the call line's words. No fields: "No fields reported".
 * Values: shown as a column only when some field has one (hasValues), else a single footer line says they are not reported.
 */
export function queryBlock(fields, { coll = '', op = 'call', hasParam = () => false } = {}) {
  if (!fields?.length) return h('div.qc-q', h('div.qc-foot', 'No fields reported for this call.'));
  const withV = hasValues(fields);
  const line = h('div.q-call', { 'data-qa': 'query-call' }, callLine(coll, op, fields, withV).map((g) => (g.k === 'tx' ? g.s : h(`span.${g.k}`, g.s))));
  const head = withV ? h('div.th', h('span', 'Field ', h('span.thx', '· value from')), h('span', 'Op')) : null;
  const gs = groups(fields).map((g) => h('div.grp', { 'data-role': g.role },
    h('div.grp-h', badge(g.role), h('span.eyebrow', g.title), h('span.opn', g.opn)),
    g.rows.map((r) => h('div.fr', { class: r.helper ? 'imp' : '' },
      h('span.fp', badge(g.role), r.f.path,
        r.helper ? h('span.bd.help', { tabindex: 0, title: r.f.flag }, 'helper') : null,
        r.noDdl ? h('span.bd.noddl', { title: 'Not in the collection schema' }, 'not in schema') : null),
      h('span.fo', { class: r.f.operator || g.role !== 'filter' ? '' : 'dim' }, r.op),
      withV ? h('span.fv.under', valueCell(r.value, hasParam)) : null))));
  return h('div.qc-q', line, head, gs, withV ? null : h('div.qc-foot', 'Values not reported by the harvester. Field names and operators come from code.'));
}
