// "Who connects" on the instance page: one lane per service (service -> access -> client and databases),
// no instance node (the page is the instance). A click on a lane docks the full client in the panel.

import { h } from '../dom.js';
import { href } from '../router.js';
import { MODE } from '../components/clients-table.js';
import { viaChip } from '../components/via-chip.js';
import { serviceLink, servicePath } from './inventory-links.js';

const RW = { read: ['R', 'reads'], write: ['W', 'writes'], read_write: ['R/W', 'reads and writes'], unknown: ['?', 'access not reported'] };
const db = (n) => `db${n}`;
const dbs = (list) => (list.length ? list.map(db).join(', ') : '');
const driverText = (d) => (d ? `${d.package}${d.version ? ' ' + d.version : ''}` : null);

/** The driver that actually runs (inside the library when there is one), how the service reaches it, and the databases. */
export function clientLine(c, databases) {
  if (!c) return h('span.via', 'client not reported', databases.length ? ` · ${dbs(databases)}` : '');
  const run = c.lib?.driver?.package ? c.lib.driver : c.driver;
  const how = c.accessMode === 'shared_lib' || c.lib ? `via ${c.lib?.package ?? 'a library'}${c.lib?.version ? ' ' + c.lib.version : ''}` : (MODE[c.accessMode] ?? 'access not reported').toLowerCase();
  const d = c.databases?.length ? c.databases : databases;
  return h('span', run?.package ? h('span.mono', driverText(run)) : h('span.via', 'driver not reported'), ' ', h('span.via', `· ${how}${d.length ? ' · ' + dbs(d) : ''}`));
}

/** The access chip: R, W or R/W. */
export const accessChip = (a) => h('span.ri-rw', { class: a === 'read' ? '' : 'w', title: RW[a][1] }, RW[a][0]);

/** `makeCard(l)` builds the keys card of a service (see instance-key-card.js). One card is open at a time: opening another closes it. */
export function lanes(v, { onPick, makeCard }) {
  const rows = new Map(), cards = new Map(), btns = new Map();
  let openSvc = null;
  const select = (service) => rows.forEach((els, s) => els.forEach((e) => e.classList.toggle('sel', s === service)));
  const cardOf = (service) => cards.get(service) ?? cards.set(service, makeCard(v.lanes.find((l) => l.service === service))).get(service);

  function setOpen(service) {
    for (const [s, b] of btns) {
      const on = s === service;
      b.setAttribute('aria-expanded', String(on));
      b.firstChild.textContent = on ? 'Hide keys' : 'Show keys';
      b.closest('.ri-lane').classList.toggle('open', on);
      if (!on) b.closest('.ri-lane').querySelector('.ri-card')?.remove();
    }
    openSvc = service;
  }
  /** Open the service's card (loading its keys), then flash `row` in it if given. */
  async function open(service, row) {
    const lane = btns.get(service)?.closest('.ri-lane');
    if (!lane) return;
    if (openSvc !== service) { setOpen(service); lane.append(cardOf(service).el); }
    lane.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    await (row ? cardOf(service).focus(row) : cardOf(service).load());
  }
  const toggle = (service) => (openSvc === service ? setOpen(null) : open(service));

  const grid = h('div.ri-grid', { role: 'table', 'aria-label': 'Services that connect' },
    h('div.ri-lrow.ri-colheads', h('div.ri-colhead', 'Service'), h('div.ri-colhead', 'Access'), h('div.ri-colhead', 'Client · databases'), h('div.ri-colhead')),
    v.lanes.map((l) => {
      const c = l.clients[0];
      const pick = () => { select(l.service); onPick(l); };
      const node = h('div.ri-node', { role: 'button', tabindex: 0, on: { click: (e) => { if (!e.target.closest('a')) pick(); }, keydown: (e) => { if (e.key === 'Enter' && !e.target.closest('a')) pick(); } } },
        h('div.ri-name', serviceLink(l.service)), h('div.ri-sub', [l.kind, l.team].filter(Boolean).join(' · ')));
      const acc = h('div.ri-acc', { on: { click: pick } }, accessChip(l.access), h('span.line'));
      const cl = h('div.ri-client', { on: { click: pick } }, clientLine(c, l.databases), l.clients.length > 1 ? h('span.via', ` · +${l.clients.length - 1} more`) : null,
        l.clients.some((x) => x.mixed.length) ? h('span.pill.warn', { style: { marginLeft: '6px' }, title: 'two majors of one driver' }, '2 drivers') : null);
      const btn = l.keyCount
        ? h('button.btn.ri-showkeys', { type: 'button', 'aria-expanded': 'false', on: { click: (e) => { e.stopPropagation(); toggle(l.service); } } }, h('span', 'Show keys'), h('span.ri-count', ` · ${l.keyCount}`))
        : h('span.ri-muted.xs', 'no keys reported');
      if (l.keyCount) btns.set(l.service, btn);
      rows.set(l.service, [node, acc, cl]);
      return h('div.ri-lane', { 'data-service': l.service }, h('div.ri-lrow', node, acc, cl, h('div.ri-kbtn', btn)));
    }));
  return { el: h('div.ri-lanes', grid), select: (s) => select(s), clear: () => select(null), open };
}

/** The docked client panel: how one service reaches the instance. Returns [head, ...content] for panel.open(). */
export function clientPane(v, l) {
  const stores = v.stores.filter((s) => s.readers.includes(l.service) || s.writers.includes(l.service));
  const used = (k) => stores.filter((s) => s[k].includes(l.service)).map((s) => s.name);
  const kv = (c) => {
    const lib = c.lib, own = c.driver;
    return h('dl.ri-kv',
      h('dt', 'Access mode'), h('dd', MODE[c.accessMode] ?? 'not reported'),
      lib ? [h('dt', 'Library'), h('dd.ri-mono', `${lib.package}${lib.version ? ' ' + lib.version : ''}${lib.kind ? ` (${lib.kind === 'in_house' ? 'in-house' : 'third-party'})` : ''}`)] : null,
      lib?.driver ? [h('dt', 'Library driver'), h('dd.ri-mono', driverText(lib.driver))] : null,
      own ? [h('dt', 'Own driver'), h('dd.ri-mono', driverText(own))] : null,
      h('dt', 'Databases'), h('dd.ri-mono', (c.databases?.length ? c.databases : l.databases).length ? dbs(c.databases?.length ? c.databases : l.databases) : 'not reported'));
  };
  const body = l.clients.length ? l.clients.map((cr, i) => {
    const raw = { accessMode: cr.accessMode, lib: cr.lib, driver: cr.driver, databases: undefined };
    return h('section.stack', { style: { gap: 'var(--s3)' } },
      h('div', h('h4.ri-panel-h', l.clients.length > 1 ? `Client ${i + 1} of ${l.clients.length}${cr.accessId ? ' · ' + cr.accessId : ''}` : 'How it reaches ' + v.name), kv(raw)),
      cr.mixed.length ? h('div.ri-problem', h('span.tag', '⚠ 2 drivers in one service'),
        h('p', `The service carries ${cr.mixed.map((m) => `${m.package} ${m.majors.map((x) => x + '.x').join(' and ')}`).join(', ')}${cr.lib ? ` (one inside ${cr.lib.package})` : ''}. Matters for the Valkey migration.`)) : null,
      cr.unresolved.length ? h('p.small.muted', cr.unresolved.map((u) => `${u.replace(/\./g, ' ').replace(/^./, (c) => c.toUpperCase())} not reported`).join('. ') + '.') : null,
      cr.via.length ? h('div', h('h4.ri-panel-h', 'Wrapper chain'), viaChip(cr.via)) : null);
  }) : h('p.small.muted', 'This service has not reported how it reaches the instance (no client on its resource).');
  return [
    h('div.grow', h('span.xs.muted', 'Client of'), h('h3.mono-title', l.service)),
    ...[].concat(body),
    stores.length ? h('div', h('h4.ri-panel-h', 'Reads and writes here'),
      h('p.small', [used('readers').length ? ['reads ', used('readers').map((n, i) => [i ? ', ' : '', h('span.ri-mono', n)])] : null, used('readers').length && used('writers').length ? ', ' : null,
        used('writers').length ? ['writes ', used('writers').map((n, i) => [i ? ', ' : '', h('span.ri-mono', n)])] : null])) : null,
    h('a.btn', { href: href(servicePath(l.service)) }, 'Open the service'),
  ];
}
