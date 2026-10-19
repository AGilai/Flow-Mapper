// The switchboard: ingress grouped by transport on the left, the service in the middle,
// egress grouped by the service it reaches on the right. Groups collapse when large.

import { h } from '../dom.js';
import { href } from '../router.js';
import { chip, splitKey, egressGroupLabel } from '../format.js';
import { icon } from '../icons.js';
import { storeLink } from './inventory-links.js';
import { objectIcon } from '../components/object-icon.js';

const OPEN_LIMIT = 15;
const UNRESOLVED = '\u0001Unresolved by the harvester';
const gapOf = (x) => x.unresolved?.find((u) => u.what === 'target');
/** Pill for an item the harvester could not resolve; the reason is in the tooltip. */
const gapPill = (u) => h('span.pill.gap', { title: [u.reason, u.detail, u.candidates?.length ? `candidates: ${u.candidates.join(', ')}` : null].filter(Boolean).join('\n') }, `unresolved: ${u.reason}`);
const atLink = (at) => (at?.url ? h('a.at-link', { href: at.url, target: '_blank', rel: 'noopener noreferrer', title: `${at.file ?? ''}${at.line ? ':' + at.line : ''}` }, icon('external')) : null);
const svcLink = (s) => h('a', { href: href(`/services/${encodeURIComponent(s)}`) }, s);

export function switchboard(v, name, q, onInfo) {
  const hit = (...xs) => !q || xs.some((x) => x && String(x).toLowerCase().includes(q));

  // ---- ingress, grouped by transport ----
  const ingress = v.ingress.filter((i) => hit(i.bindKey, i.handler, ...i.callers.map((c) => c.service)));
  const byT = group(ingress, (i) => i.transport);
  const left = h('div.sb-col.sb-left',
    h('h2', 'Ingress', h('span.muted.small', String(ingress.length))),
    byT.length ? byT.map(([t, items]) => details(chip(t), items.length, items.length <= OPEN_LIMIT || !!q,
      items.map((i) => h('div.sb-row', { 'data-t': gapOf(i) ? 'gap' : i.orphan ? 'broken' : i.transport, class: '' },
        h('span', h('a.key', { href: href('/flows', { service: name, ingress: i.id }) , title: 'Trace from here' }, gapOf(i) && i.bindKey.startsWith('unresolved:') ? (i.id || gapOf(i).detail || '(no id)') : splitKey(i.bindKey).rest), atLink(i.at)),
        h('span.xs.sb-actions', gapOf(i) ? gapPill(gapOf(i)) : i.entryPoint ? h('span.pill', 'entry') : i.orphan ? h('span.pill.warn', 'never called') : null,
          i.events?.length ? h('span.pill', { title: i.events.map((e) => e.type).join(', ') }, `${i.events.length} event ${i.events.length === 1 ? 'type' : 'types'}`) : null,
          onInfo ? h('button.btn.ghost.icon-btn', { type: 'button', title: 'Endpoint info', 'aria-label': `Info for ${i.bindKey}`, on: { click: () => onInfo(i.id) } }, icon('info')) : null),
        h('div.peers', h('span', 'handler ', h('span.key', i.handler)),
          i.callers.length ? h('span', 'from ', join(uniq(i.callers.map((c) => c.service)).map(svcLink))) : null,
          i.maybeCallers?.length ? h('span', { title: 'Event types not resolved by the harvester; may pass the subscription filter' }, 'maybe from ', join(uniq(i.maybeCallers.map((c) => c.service)).map(svcLink))) : null,
          uniq(i.callers.flatMap((c) => c.via)).length ? h('span', 'via ', uniq(i.callers.flatMap((c) => c.via)).join(', ')) : null))))) :
      h('p.small.muted', q ? 'No ingress matches.' : 'This service has no ingress.'));

  // ---- egress, grouped by the service reached ----
  const egress = v.egress.filter((e) => hit(e.bindKey, ...e.usedBy, ...e.targets.map((t) => t.service)));
  const byTarget = group(egress, (e) => (gapOf(e) ? UNRESOLVED : e.dangling ? '\u0000No match' : uniq(e.targets.map((t) => t.service)).join(', ') || (e.maybeTargets?.length ? 'Maybe ' + uniq(e.maybeTargets.map((t) => t.service)).join(', ') : 'No consumer')))
    .sort((a, b) => Number(b[0] < '\u0002') - Number(a[0] < '\u0002'));
  const resources = v.resources.filter((r) => hit(r.name, r.kind, ...r.operations.map((o) => o.fn)));
  const right = h('div.sb-col.sb-right',
    h('h2', 'Egress', h('span.muted.small', String(egress.length))),
    byTarget.map(([target, items]) => {
      const broken = target.startsWith('\u0000');
      const label = target === UNRESOLVED ? h('span.muted', 'Unresolved by the harvester')
        : broken ? h('span', { style: { color: 'var(--bad)' } }, 'No match') : h('span.truncate', egressGroupLabel(target, items));
      return details(label, items.length, items.length <= OPEN_LIMIT || broken || !!q, items.map((e) =>
        h('div.sb-row', { 'data-t': gapOf(e) ? 'gap' : e.dangling ? 'broken' : e.transport },
          h('span', h('span.key', gapOf(e) && e.bindKey.startsWith('unresolved:') ? (gapOf(e).detail || e.id || (e.source ? `${e.source.file}:${e.source.line ?? ''}` : '(no id)')) : e.bindKey), atLink(e.at)),
          h('span', gapOf(e) ? gapPill(gapOf(e)) : chip(e.transport), e.mode === 'async' ? ' ' : null, e.mode === 'async' ? chip('async', 'async') : null),
          h('div.peers',
            e.usedBy.length ? h('span', 'from ', e.usedBy.slice(0, 3).map((f) => h('span.key', f + ' '))) : null,
            e.targets.length ? h('span', 'to ', join(uniq(e.targets.map((t) => t.service)).slice(0, 6).map(svcLink))) : null,
            e.maybeTargets?.length ? h('span', { title: 'Event types not resolved by the harvester; may pass the subscription filter' }, 'maybe to ', join(uniq(e.maybeTargets.map((t) => t.service)).slice(0, 6).map(svcLink))) : null,
            uniq(e.targets.flatMap((t) => t.via)).length ? h('span', 'via ', uniq(e.targets.flatMap((t) => t.via)).join(', ')) : null))));
    }),
    resources.length ? details(h('span', 'Data stores'), resources.length, true, resources.map((r) =>
      h('div.sb-row', { 'data-t': 'res' },
        h('span.name-cell', objectIcon('store', r.kind, 18), h('b', storeLink(r.bindKey ?? `${name}:${r.id}`, r.name)), h('span.muted.small', r.kind)),
        h('span.xs.muted', r.sharedWith.length ? `shared with ${r.sharedWith.length}` : ''),
        h('div.peers', uniq(r.operations.map((o) => o.operation)).slice(0, 6).map((o) => h('span.key', o)))))) : null,
    !egress.length && !resources.length ? h('p.small.muted', q ? 'No egress matches.' : 'This service calls nothing.') : null);

  const core = h('div.sb-core',
    h('div.name', name),
    h('div.small.muted', `${v.functions.length} functions`),
    v.channels.length ? h('div.small', `${v.channels.length} queues and topics declared`) : null,
    v.bindings.length ? h('div.small', `${v.bindings.length} subscriptions`, v.bindings.some((b) => b.match === 'glob') ? ' (incl. wildcard)' : '') : null);

  return h('div.switchboard', left, core, right);
}

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
