// Group by Package (frame 29a/29b): per package a header row with the verdict pill, then one row per version,
// newest first, with the components on it, resources, operations and how it is reached. A row expands to its resources.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { storeLink } from './inventory-links.js';
import { compChip, lagMark, LAG } from '../components/drivers-parts.js';
import { lagLevel } from '../../core/drivers.js';

export const ACCESS = { direct_driver: 'direct driver', shared_lib: 'shared library', self_implemented_wrapper: 'self-implemented wrapper', third_party_lib: 'third-party library' };
const KIND = { in_house: 'in-house', third_party: 'third-party' };
const n = (x, one, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;
export const opsText = (o) => (o.total ? `${o.total}${o.read + o.write ? ` (${[o.read ? `r ${o.read}` : '', o.write ? `w ${o.write}` : ''].filter(Boolean).join(' · ')})` : ''}` : '0');

/** The pill in a package header: how many majors are in use, or the newest major when the filter hides it. */
function majorsPill(p, shownBaseline) {
  const worst = Math.max(0, ...p.versions.map((v) => v.lag));
  if (!shownBaseline) return h('span.dv-pill', { class: lagLevel(worst) === 2 ? 'mix2' : 'mix' }, `newest major in env: ${p.baseline}`);
  if (p.majors.length < 2) return h('span.dv-pill.ok', 'single version');
  return h('span.dv-pill', { class: lagLevel(worst) === 2 ? 'mix2' : 'mix' }, `${p.majors.length} majors in use: ${p.majors.join(', ')}`);
}

/** How a version is reached: direct, and/or through a wrapper library; the own version gap of a component on it. */
function reached(v, ownGaps) {
  const gap = v.components.some((c) => ownGaps.has(c.service));
  return h('td.dv-via',
    v.direct ? h('div', 'direct') : null,
    v.via.map((x) => h('div.mu', 'via ', h('span.mono', `${x.lib}${x.version ? ' ' + x.version : ''}`), x.kind ? ` (${KIND[x.kind]})` : '')),
    gap ? h('div.mu', 'own driver version unresolved') : null);
}

function resourceTable(v) {
  return h('tr.dv-xp', h('td', { colSpan: 5 }, h('div.dv-xt', h('table.dv-t',
    h('thead', h('tr', ['Component', 'Resource (store key)', 'Access', 'Operations'].map((t, i) => h('th', { class: i === 3 ? 'r' : '' }, t)))),
    h('tbody', v.entries.map((e) => h('tr', h('td', compChip(e.service, {})), h('td', e.entity === 'resource' && e.store ? storeLink(e.store) : h('span.mono', e.store ?? e.resource)),
      h('td', ACCESS[e.accessMode] ?? 'access not reported'), h('td.r', opsText(e.ops)))))))));
}

/** `table`: DriverTable (filtered); `unresolved`: UnresolvedItem[] of this store type (for the own-version note); `open`: drawer opener; `expanded`: Set of row keys. */
export function packageTable(table, { unresolved, open, expanded, onToggle }) {
  const ownGaps = new Set(unresolved.filter((u) => u.field === 'driver.version').map((u) => u.service));
  const tbody = h('tbody');
  for (const p of table.packages) {
    const shown = p.versions.some((v) => v.major === p.baseline);
    tbody.append(h('tr.pk', h('td', { colSpan: 5 }, h('div.dv-pkn', h('b', p.package), h('span.d', `${n(p.components, 'component')} · ${n(p.versions.length, 'version')}`), h('span.grow'),
      majorsPill(p, shown), h('span.dv-pill.ok', `${n(p.resources, 'resource')} · ${n(p.ops.total, 'operation')}`)))));
    for (const v of p.versions) {
      const key = `${p.package}@${v.version}`, isOpen = expanded.has(key), l = lagLevel(v.lag);
      const tr = h('tr.dv-vrow', { class: LAG[l], 'data-qa': 'drivers-version', 'data-key': key, tabindex: 0, 'aria-expanded': String(isOpen) },
        h('td', h('span.dv-chev', icon('chev')), h('span.dv-ver', v.version), lagMark(v.lag, p.majors.length > 1 && v.major === p.baseline)),
        h('td', h('div.dv-cc', v.components.map((c) => compChip(c.service, { res: c.resources, mixed: c.mixed, open })))),
        h('td.r', String(v.resources)), h('td.r', String(v.ops.total)), reached(v, ownGaps));
      if (isOpen) tr.classList.add('open');
      const toggle = (e) => { if (e.target.closest('a')) return; onToggle(key); };
      tr.addEventListener('click', toggle);
      tr.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onToggle(key); } });
      tbody.append(tr);
      if (isOpen) tbody.append(resourceTable(v));
    }
  }
  return h('div.dv-card', h('table.dv-t.dv-pk', h('colgroup', h('col', { style: { width: '22%' } }), h('col'), h('col', { style: { width: '9%' } }), h('col', { style: { width: '10%' } }), h('col', { style: { width: '22%' } })),
    h('thead', h('tr', ['Version', 'Components', 'Resources', 'Operations', 'How it is reached'].map((t, i) => h('th', { class: i === 2 || i === 3 ? 'r' : '' }, t)))), tbody));
}
