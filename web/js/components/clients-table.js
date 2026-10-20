// Clients of a data store: one row per client site — service, how it reaches the store, its own
// driver, the wrapper library with the driver bundled in it, and the via chip (#27).
// Status sits next to the thing it describes: coloured major pills beside versions that are mixed,
// "version unknown" and its reason beside the version.

import { h } from '../dom.js';
import { serviceLink } from '../views/inventory-links.js';
import { viaChip } from './via-chip.js';

export const MODE = { direct_driver: 'Direct driver', shared_lib: 'Shared library', self_implemented_wrapper: 'Own wrapper class', third_party_lib: 'Third-party library' };
const REASON = { lockfile_not_found: 'not in lockfile' };

const dash = () => h('span.muted', '—');
/** A path or identifier that may only break after `/` and `.`. */
export const breakable = (s) => String(s).split(/(?<=[/.])/).flatMap((p, i) => (i ? [h('wbr'), p] : [p]));
const reasonText = (r) => REASON[r] ?? String(r).replace(/_/g, ' ');

/** "version unknown" next to the reason the harvester gave, when it gave one. */
const unknown = (reason) => h('span.client-gap', h('span.pill.gap', 'version unknown'), reason ? h('span.xs.muted', reasonText(reason)) : null);

/** "ioredis 5.3.2" (package mono, version in the body font); a warn pill with the major when the service carries two majors of it. */
const driver = (d, mixed, reason) => h('span.client-ver', h('span.key', d.package),
  d.version ? h('span', { title: d.versionSource ? `version from ${d.versionSource}` : '' }, d.version) : unknown(reason),
  mixed ? h('span.pill.warn', `${d.major}.x`) : null);

function drivers(r, mixedPkgs) {
  const own = r.drivers.find((d) => d.from === 'own');
  if (own) return driver(own, mixedPkgs.has(own.package), r.reasons['driver.version']);
  return r.driver?.package ? driver({ package: r.driver.package }, false, r.reasons['driver.version']) : dash();
}

function lib(r, mixedPkgs) {
  if (!r.lib) return dash();
  const d = r.drivers.find((x) => x.from === 'lib');
  return h('div.stack', { style: { gap: '2px' } },
    h('span.client-ver', { title: r.lib.kind === 'in_house' ? 'In-house library' : r.lib.kind === 'third_party' ? 'Third-party library' : '' },
      h('span.key', r.lib.package), r.lib.version ?? unknown(r.reasons['lib.version'])),
    d ? h('span.small.client-ver', h('span.muted', 'bundles'), driver(d, mixedPkgs.has(d.package), r.reasons['lib.driver.version']))
      : h('span.small.muted', 'bundled driver not reported'));
}

/** One line for a store with a single client, e.g. "orders-svc · direct driver mongodb 6.3.0". */
export function clientLine(r) {
  const d = r.drivers.find((x) => x.from === 'own');
  const via = r.lib ? `${r.lib.package}${r.lib.version ? ' ' + r.lib.version : ''}` : null;
  const what = [d ? `${d.package}${d.version ? ' ' + d.version : ''}` : null, via ? `through ${via}` : null].filter(Boolean).join(' ');
  return `${r.service} · ${(MODE[r.accessMode] ?? 'access not reported').toLowerCase()}${what ? ' ' + what : ''}`;
}

/** rows: ClientRow[] from the API (`clients` of a store view, or `rows` of /clients). */
export function clientsTable(rows) {
  return h('div', { style: { overflowX: 'auto' } }, h('table.grid.clients',
    h('thead', h('tr', ['Service', 'Access', 'Driver', 'Library and its driver', 'Via'].map((t) => h('th', t)))),
    h('tbody', rows.map((r) => {
      const mixedPkgs = new Set(r.mixed.map((m) => m.package));
      return h('tr', { class: r.mixed.length ? 'mixed' : '' },
        h('td', h('div.stack', { style: { gap: '2px' } },
          h('b.nowrap', serviceLink(r.service)),
          r.accessId ? h('span.xs.muted.key', breakable(r.accessId)) : null)),
        h('td.nowrap', r.accessMode ? MODE[r.accessMode] ?? r.accessMode : dash()),
        h('td', drivers(r, mixedPkgs)),
        h('td', lib(r, mixedPkgs)),
        h('td', viaChip(r.via) ?? dash()));
    }))));
}
