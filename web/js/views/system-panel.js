// Info panel content for a node on the system map (service, gateway, queue, store, missing target).
// Edges: see edge-panel.js.

import { h } from '../dom.js';
import { href } from '../router.js';
import { chip, filterText } from '../format.js';
import { section } from '../components/panel.js';
import { channelPath, storePath } from './inventory-links.js';
import { objectIcon } from '../components/object-icon.js';

const MAX = 12;
const svcName = (id) => id.replace(/^(svc|ch|res|missing):/, '');

export function nodePanel(n, edges, byId) {
  const out = edges.filter((e) => e.from === n.id);
  const inc = edges.filter((e) => e.to === n.id);
  const kindLabel = { service: 'Service', gateway: 'Gateway', channel: n.sub, resource: `Data store (${n.sub})`, missing: 'No match' }[n.kind] ?? n.kind;
  const type = n.kind === 'channel' ? 'channel' : n.kind === 'resource' ? 'store' : n.kind === 'missing' ? null : 'service';
  const kind = type === 'service' ? n.svcKind ?? n.kind : n.sub;
  const head = h('div.stack', { style: { gap: '2px' } }, h('h2.titled', { class: n.kind === 'missing' ? 'key' : '' }, type ? objectIcon(type, kind, 24) : null, h('span', n.label)), h('span.small.muted', kindLabel, n.team ? `, team ${n.team}` : ''));

  const neighbour = (e, other) => {
    const o = byId.get(other);
    const link = o && (o.kind === 'service' || o.kind === 'gateway') ? href(`/services/${encodeURIComponent(o.label)}`) : null;
    return h('div.list-item',
      e.broken ? chip('broken', 'broken') : (e.transports.filter((t) => t !== 'other').map((t) => chip(t)).slice(0, 2)),
      e.modes.includes('async') && !e.modes.includes('sync') ? chip('async', 'async') : null,
      link ? h('a.grow.truncate', { href: link }, o.label) : h('span.grow.truncate', { class: o?.kind === 'missing' ? 'key' : '' }, o?.label ?? svcName(other)),
      h('span.xs.muted', `${e.endpoints.length}`));
  };
  const list = (es, side) => {
    const sorted = [...es].sort((a, b) => Number(b.broken) - Number(a.broken) || b.endpoints.length - a.endpoints.length);
    return [
      h('div.list', sorted.slice(0, MAX).map((e) => neighbour(e, side === 'out' ? e.to : e.from))),
      sorted.length > MAX ? h('p.xs.muted', `${sorted.length - MAX} more. Open the service view to see all.`) : null,
    ];
  };

  const body = [];
  if (n.stats) {
    body.push(h('dl.kv',
      h('dt', 'Ingress'), h('dd', String(n.stats.ingress)),
      h('dt', 'Egress'), h('dd', String(n.stats.egress)),
      h('dt', 'Functions'), h('dd', String(n.stats.functions)),
      h('dt', 'Broken calls'), h('dd', { style: { color: n.stats.dangling ? 'var(--bad)' : '' } }, String(n.stats.dangling)),
      h('dt', 'Never called'), h('dd', String(n.stats.orphans))));
    body.push(h('div.row',
      h('a.btn.primary', { href: href(`/services/${encodeURIComponent(n.label)}`) }, 'Open service'),
      h('a.btn', { href: href('/flows', { service: n.label }) }, 'Trace flows')));
  }
  if (n.kind === 'channel') body.push(h('div.row', h('a.btn.primary', { href: href(channelPath(svcName(n.id))) }, 'Open details')));
  if (n.kind === 'resource') body.push(h('div.row', h('a.btn.primary', { href: href(storePath(svcName(n.id))) }, 'Open details')));
  if (n.kind === 'missing') body.push(h('p.small', 'Something calls this key, but no service, queue or route matches it. Check the bind key the harvester produced on either side.'));
  if (n.events?.length) body.push(section('Event types published here', n.events.length, h('div.ep-producers', n.events.map((e) => h('span.ep-producer', h('span.key', e))))));
  if (n.subscriptions?.length) body.push(section(n.sub === 'eventbridge-bus' ? 'Rules' : 'Subscriptions', n.subscriptions.length, h('div.list', n.subscriptions.map((s) =>
    h('div.list-item', { title: `declared by ${s.service} (${s.id})` },
      h('span.grow.truncate.key', s.to),
      s.events === '*' ? h('span.pill', 'all events') : h('span.xs', filterText(s.events)),
      s.conflict ? h('span.pill.warn', { title: 'Reported differently by another manifest' }, 'conflict') : null)))));
  if (inc.length) body.push(section(n.kind === 'channel' ? 'Published by' : 'Called by', inc.length, list(inc, 'in')));
  if (out.length) body.push(section(n.kind === 'channel' ? 'Delivers to' : 'Calls', out.length, list(out, 'out')));
  return [head, body];
}
