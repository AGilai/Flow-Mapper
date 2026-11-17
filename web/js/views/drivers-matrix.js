// Group by Component (frame 29c): a component x store type matrix. Each cell lists package and version with the
// lag number and how it is reached; a row opens the component drawer. An "Others" column is the place for SQS/SNS SDKs
// and HTTP clients until harvesters report them.

import { h } from '../dom.js';
import { compChip, gapPill, LAG } from '../components/drivers-parts.js';
import { lagLevel, lagOf } from '../../core/drivers.js';
import { kindLabel, typeOrder } from './drivers-kinds.js';


function cell(service, kind, { entries, unresolved, base }) {
  const es = entries.filter((e) => e.service === service && e.kind === kind), us = unresolved.filter((u) => u.service === service && u.kind === kind);
  if (!es.length && !us.length) return h('td.mu', '—');
  const seen = new Set(), items = [];
  for (const e of es) {
    const k = `${e.package}@${e.version}@${e.lib?.package ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const lag = lagOf(e, base), l = lagLevel(lag);
    items.push(h('div', h('span.dv-pv', { class: LAG[l] }, h('b', e.package), h('span.ver2', e.version), lag > 0 ? h('span.tag', { class: LAG[l] }, `−${lag}`) : null, e.lib ? h('span.tag', { class: LAG[l] }, `via ${e.lib.package}`) : null)));
  }
  for (const u of us) items.push(h('div', gapPill(u.field.endsWith('version') ? 'own version unresolved' : `${u.field.split('.')[0]} unresolved`), u.candidates.length ? h('span.s.mu', ` ${u.candidates.join(' | ')}`) : null));
  if (es.some((e) => e.mixed)) items.push(h('div', h('span.dv-pill.mix', `${new Set(es.map((e) => e.major)).size} majors`)));
  return h('td', items);
}

/** `kinds`: store types to show as columns. `open(service)`: drawer; `selected`: the open service. */
export function componentMatrix(ctx, kinds, { open, selected }) {
  const services = [...new Set([...ctx.entries, ...ctx.unresolved].map((x) => x.service))].sort();
  if (!services.length) return h('div.dv-card', h('div.dv-empty', h('b', 'No component matches'), h('span', 'Clear a filter to see every component with a client.')));
  return h('div.dv-card', h('table.dv-t.dv-mx', h('thead', h('tr', h('th', 'Component'), kinds.map((k) => h('th', kindLabel(k))), h('th', 'Others'))),
    h('tbody', services.map((s) => {
      const tr = h('tr', { class: s === selected ? 'selr' : '', tabindex: 0, 'data-qa': 'drivers-component', 'data-service': s },
        h('td', compChip(s, { open, selected: s === selected })), kinds.map((k) => cell(s, k, ctx)), h('td.mu.s', 'no data'));
      tr.addEventListener('click', (e) => { if (!e.target.closest('a')) open(s); });
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(s); });
      return tr;
    }))));
}
