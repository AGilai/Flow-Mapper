// One component's drivers across all store types (frame 29c): the drawer of the Drivers tab and the
// "Drivers" section of the component page render the same thing. Version, lag, how it is reached, resources.

import { h } from '../dom.js';
import { storeLink } from './inventory-links.js';
import { lagMark, LAG, gapPill, reasonText } from '../components/drivers-parts.js';
import { lagLevel, lagOf } from '../../core/drivers.js';
import { ACCESS, opsText } from './drivers-table.js';

import { kindLabel } from './drivers-kinds.js';
export { kindLabel };
const n = (x, one, many = `${one}s`) => `${x} ${x === 1 ? one : many}`;

/** Entries of one service, grouped store type → package+version (one driver per row, its resources under it). */
export function componentGroups(service, { entries, unresolved }) {
  const by = new Map();
  const slot = (kind) => by.get(kind) ?? by.set(kind, { kind, drivers: new Map(), gaps: [], ops: 0, res: new Set() }).get(kind);
  for (const e of entries.filter((x) => x.service === service)) {
    const g = slot(e.kind), k = `${e.package}@${e.version}`;
    (g.drivers.get(k) ?? g.drivers.set(k, { e, uses: [] }).get(k)).uses.push(e);
    g.ops += e.ops.total; g.res.add(e.resource);
  }
  for (const u of unresolved.filter((x) => x.service === service)) { const g = slot(u.kind); g.gaps.push(u); g.res.add(u.resource); }
  return [...by.values()].sort((a, b) => a.kind.localeCompare(b.kind));
}

const via = (e) => (e.lib ? ['via ', h('span.mono', `${e.lib.package}${e.lib.version ? ' ' + e.lib.version : ''}`), e.lib.kind ? ` (${e.lib.kind === 'in_house' ? 'in-house' : 'third-party'})` : ''] : e.accessMode ? ACCESS[e.accessMode] : 'direct');

function driverBlock({ e, uses }, base) {
  const lag = lagOf(e, base), l = lagLevel(lag);
  return h('div.dv-dd', { class: LAG[l] },
    h('div.top', h('span.pn', e.package), h('span.dv-ver', e.version), lagMark(lag)),
    h('div.s.mu', via(e)),
    uses.map((u) => h('div.s', u.entity === 'resource' && u.store ? storeLink(u.store) : h('span.mono', u.store ?? u.resource), ` · ${opsText(u.ops)} ops`)));
}

/** `ctx`: {entries, base, unresolved, showInTable?(kind)}. Returns the nodes of the body. */
export function componentDrivers(service, ctx) {
  const groups = componentGroups(service, ctx);
  if (!groups.length) return [h('p.s.mu', `${service} has no client or driver data in this environment.`)];
  const drivers = groups.reduce((a, g) => a + g.drivers.size, 0);
  const behind = groups.flatMap((g) => [...g.drivers.values()]).filter((d) => lagOf(d.e, ctx.base) > 0).length;
  const gaps = groups.reduce((a, g) => a + g.gaps.length, 0);
  const verdict = h('p.dv-vd', h('b', `${n(groups.length, 'store type')}, ${n(drivers, 'driver')}. `), behind ? h('span.dv-t1', `${behind} ${behind === 1 ? 'is' : 'are'} behind the newest major in use`) : 'None is behind the newest major in use', gaps ? `; ${n(gaps, 'entry', 'entries')} unresolved` : '', '.');
  return [verdict, groups.map((g) => h('section.dv-dsec', h('div.h', h('b', kindLabel(g.kind)), h('span.s.mu', `${n(g.res.size, 'resource')} · ${n(g.ops, 'operation')}`), h('span.grow'),
    ctx.showInTable ? h('a', { href: '#', on: { click: (ev) => { ev.preventDefault(); ctx.showInTable(g.kind); } } }, 'Show in table') : null),
  [...g.drivers.values()].map((d) => driverBlock(d, ctx.base)),
  g.gaps.map((u) => h('div.dv-dd', h('div.top', h('span.pn', u.package ?? u.field), gapPill(u.field.endsWith('version') ? 'version unresolved' : `${u.field} unresolved`)),
    h('div.s.mu', reasonText(u.reason), u.candidates.length ? [' · candidates ', h('span.mono', u.candidates.join(' | '))] : ''),
    u.plain ? h('div.s', u.plain) : null, u.store ? h('div.s', storeLink(u.store)) : null))))];
}
