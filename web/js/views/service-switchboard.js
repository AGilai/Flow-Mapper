// The switchboard: ingress grouped by transport on the left, the service in the middle,
// egress grouped by the service it reaches on the right. Groups collapse when large.

import { h } from '../dom.js';
import { href } from '../router.js';
import { chip, splitKey, egressGroupLabel } from '../format.js';
import { icon } from '../icons.js';
import { storeLink } from './inventory-links.js';
import { objectIcon } from '../components/object-icon.js';
import { viaChip, callSitesList } from '../components/via-chip.js';

const OPEN_LIMIT = 15;
const UNRESOLVED = '\u0001Unresolved by the harvester';
const gapOf = (x) => x.unresolved?.find((u) => u.what === 'target');
/** Pill for an item the harvester could not resolve; the reason is in the tooltip. */
const gapPill = (u) => h('span.pill.gap', { title: [u.reason, u.detail, u.candidates?.length ? `candidates: ${u.candidates.join(', ')}` : null].filter(Boolean).join('\n') }, `unresolved: ${u.reason}`);
const atLink = (at) => (at?.url ? h('a.at-link', { href: at.url, target: '_blank', rel: 'noopener noreferrer', title: `${at.file ?? ''}${at.line ? ':' + at.line : ''}` }, icon('external')) : null);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** The group an AMQP item sits in (0.19.0): "amqp rpc" (olive, a call and its reply) and "amqp" (grape, a message on an exchange). */
const RPC_G = '\u0003rpc', AMQP_G = '\u0003amqp';
const groupChip = (g) => (g === RPC_G ? chip('rpc', 'amqp rpc') : chip('amqp'));
const seconds = (ms) => (ms % 1000 ? `${ms} ms` : `${ms / 1000} s`);
const svcLink = (s) => h('a', { href: href(`/services/${encodeURIComponent(s)}`) }, s);

export function switchboard(v, name, q, onInfo) {
  const hit = (...xs) => !q || xs.some((x) => x && String(x).toLowerCase().includes(q));

  // ---- ingress, grouped by transport ----
  const ingress = v.ingress.filter((i) => hit(i.bindKey, i.handler, ...i.callers.map((c) => c.service)));
  const byT = group(ingress, (i) => (i.rpc ? RPC_G : i.transport));
  const left = h('div.sb-col.sb-left',
    h('h2', 'Ingress', h('span.muted.small', String(ingress.length))),
    byT.length ? byT.map(([t, items]) => details(t === RPC_G ? [groupChip(t), queueNote(items)] : chip(t), items.length, items.length <= OPEN_LIMIT || !!q,
      items.map((i) => h('div.sb-row', { 'data-t': gapOf(i) ? 'gap' : i.orphan ? 'broken' : i.rpc ? 'rpc' : i.transport, class: '' },
        h('span', h('a.key', { href: href('/flows', { service: name, ingress: i.id }) , title: 'Trace from here' }, i.rpc ? i.rpc.command : gapOf(i) && i.bindKey.startsWith('unresolved:') ? (i.id || gapOf(i).detail || '(no id)') : splitKey(i.bindKey).rest), atLink(i.at)),
        h('span.xs.sb-actions', gapOf(i) ? gapPill(gapOf(i)) : i.entryPoint ? h('span.pill', 'entry') : i.orphan ? h('span.pill.warn', 'never called') : null,
          i.events?.length ? h('span.pill', { title: i.events.map((e) => e.type).join(', ') }, `${i.events.length} event ${i.events.length === 1 ? 'type' : 'types'}`) : null,
          onInfo ? h('button.btn.ghost.icon-btn', { type: 'button', title: 'Endpoint info', 'aria-label': `Info for ${i.bindKey}`, on: { click: () => onInfo(i.id) } }, icon('info')) : null),
        h('div.peers', h('span', 'handler ', h('span.key', i.handler)),
          i.callers.length ? h('span', 'from ', join(uniq(i.callers.map((c) => c.service)).map(svcLink))) : null,
          i.noCaller ? h('span.muted', 'no harvested caller') : null,
          i.maybeCallers?.length ? h('span', { title: 'Event types not resolved by the harvester; may pass the subscription filter' }, 'maybe from ', join(uniq(i.maybeCallers.map((c) => c.service)).map(svcLink))) : null,
          uniq(i.callers.flatMap((c) => c.via)).length ? h('span', 'through ', uniq(i.callers.flatMap((c) => c.via)).join(', ')) : null,
          viaChip(i.via)))))) :
      h('p.small.muted', q ? 'No ingress matches.' : 'This service has no ingress.'));

  // ---- egress, grouped by the service reached ----
  const egress = v.egress.filter((e) => hit(e.bindKey, ...e.usedBy, ...e.targets.map((t) => t.service)));
  const byTarget = group(egress, (e) => (gapOf(e) ? UNRESOLVED : e.dangling ? '\u0000No match' : e.rpc ? RPC_G : e.amqp ? AMQP_G : uniq(e.targets.map((t) => t.service)).join(', ') || (e.maybeTargets?.length ? 'Maybe ' + uniq(e.maybeTargets.map((t) => t.service)).join(', ') : 'No consumer')))
    .sort((a, b) => rank(a[0]) - rank(b[0]));
  const resources = v.resources.filter((r) => hit(r.name, r.kind, ...r.operations.map((o) => o.fn)));
  const right = h('div.sb-col.sb-right',
    h('h2', 'Egress', h('span.muted.small', String(egress.length))),
    byTarget.map(([target, items]) => {
      const broken = target.startsWith('\u0000');
      const label = target === RPC_G || target === AMQP_G ? groupChip(target) : target === UNRESOLVED ? h('span.muted', 'Unresolved by the harvester')
        : broken ? h('span', { style: { color: 'var(--bad)' } }, 'No match') : h('span.truncate', egressGroupLabel(target, items));
      return details(label, items.length, items.length <= OPEN_LIMIT || broken || !!q, items.map((e) =>
        h('div.sb-row', { 'data-t': gapOf(e) ? 'gap' : e.dangling ? 'broken' : e.rpc ? 'rpc' : e.transport },
          h('span', h('span.key', e.rpc ? e.rpc.command : e.amqp ? e.amqp.routingKey || e.amqp.exchange : gapOf(e) && e.bindKey.startsWith('unresolved:') ? (gapOf(e).detail || e.id || (e.source ? `${e.source.file}:${e.source.line ?? ''}` : '(no id)')) : e.bindKey), atLink(e.at)),
          h('span.sb-actions', gapOf(e) ? gapPill(gapOf(e)) : e.rpc ? (e.rpc.timeoutMs ? h('span.xs.muted', `timeout ${seconds(e.rpc.timeoutMs)}`) : null) : e.amqp ? null : [chip(e.transport), e.mode === 'async' ? [' ', chip('async', 'async')] : null]),
          h('div.peers',
            e.usedBy.length ? h('span', 'from ', e.usedBy.slice(0, 3).map((f) => h('span.key', f + ' '))) : null,
            e.amqp ? h('span', '→ ', h('span.key', e.amqp.exchange), e.amqp.bindings.length ? [`, ${plural(e.amqp.bindings.length, 'binding')} (`, h('span.key', e.amqp.bindings.slice(0, 3).join(', ')), e.amqp.bindings.length > 3 ? ', …' : '', ')'] : ', no binding matches') : null,
            e.rpc ? e.targets.length ? h('span', '→ ', join(e.targets.map((t) => [svcLink(t.service), ' ', h('span.key', t.handler)]))) : h('span.muted', 'no harvested server') : null,
            !e.rpc && e.targets.length ? h('span', 'to ', join(uniq(e.targets.map((t) => t.service)).slice(0, 6).map(svcLink))) : null,
            e.maybeTargets?.length ? h('span', { title: 'Event types not resolved by the harvester; may pass the subscription filter' }, 'maybe to ', join(uniq(e.maybeTargets.map((t) => t.service)).slice(0, 6).map(svcLink))) : null,
            uniq(e.targets.flatMap((t) => t.via)).length ? h('span', 'through ', uniq(e.targets.flatMap((t) => t.via)).join(', ')) : null,
            viaChip(e.via), callSitesList(e.callSites)))));
    }),
    resources.length ? details(h('span', 'Data stores'), resources.length, true, resources.map((r) =>
      h('div.sb-row', { 'data-t': 'res' },
        h('span.name-cell', objectIcon('store', r.kind, 18), h('b', storeLink(r.bindKey ?? `${name}:${r.id}`, r.name)), h('span.muted.small', r.kind)),
        h('span.xs.muted', r.sharedWith.length ? `shared with ${r.sharedWith.length}` : ''),
        h('div.peers', uniq(r.operations.map((o) => o.operation)).slice(0, 6).map((o) => h('span.key', o)))))) : null,
    !egress.length && !resources.length ? h('p.small.muted', q ? 'No egress matches.' : 'This service calls nothing.') : null);

  const rpcServed = v.ingress.filter((i) => i.rpc).length;
  const core = h('div.sb-core',
    h('div.name', name),
    h('div.small.muted', `${v.functions.length} functions`),
    rpcServed ? h('div.small', `${plural(rpcServed, 'RPC command')} served`) : null,
    v.channels.length ? h('div.small', `${v.channels.length} queues and topics declared`) : null,
    v.bindings.length ? h('div.small', `${v.bindings.length} subscriptions`, v.bindings.some((b) => b.match === 'glob') ? ' (incl. wildcard)' : '') : null);

  return h('div.switchboard', left, core, right);
}

/** "command queue rpcv2.sxdns" once in the group header (several queues: how many). */
function queueNote(items) {
  const qs = uniq(items.map((i) => i.rpc.commandQueue).filter(Boolean));
  return qs.length ? h('span.xs.muted.sb-note', qs.length === 1 ? ['command queue ', h('span.key', qs[0])] : `${qs.length} command queues`) : null;
}
/** Unresolved and "No match" first, then the AMQP groups, then the services reached. */
const rank = (k) => (k < '\u0002' ? 0 : k === RPC_G ? 1 : k === AMQP_G ? 2 : 3);
function details(label, count, open, rows) {
  return h('details.sb-group', { open }, h('summary', label, h('span.muted', String(count))), rows);
}
function group(xs, key) {
  const m = new Map();
  for (const x of xs) { const k = key(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); }
  return [...m].sort((a, b) => a[0].localeCompare(b[0]));
}
const uniq = (xs) => [...new Set(xs)];
const join = (els) => els.flatMap((e, i) => (i ? [', ', e] : [e]));
