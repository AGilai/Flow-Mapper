// The service boxes of the event page. A producer is one node however many call sites it has; a consumer
// is one node however many ingresses (and queues) reach it, with the outcome for this event type inside.

import { h } from '../dom.js';
import { wbr } from './flow-nodes.js';

const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The outcome of this event type at a consumer: { kind: ok | warn | maybe, title, small }. */
export function outcomeOf(rows, producer) {
  const sure = rows.filter((r) => r.outcome !== 'possible');
  if (!sure.length) {
    const sent = rows[0].ifSent === 'handled' ? 'handled' : 'arrives with no handler';
    return { kind: 'maybe', title: 'Possible', small: `${sent}, if ${producer} sends it` };
  }
  const ings = uniqueIngresses(sure);
  const ok = ings.filter((i) => i.outcome === 'handled');
  if (ok.length === ings.length) {
    const catchAll = ings.length === 1 && ings[0].any && !ings[0].handles.length;
    return { kind: 'ok', title: 'Handled', small: ings.length > 1 ? (ings.length === 2 ? 'by both ingresses' : `by all ${ings.length} ingresses`) : catchAll ? 'by its catch-all handler' : null };
  }
  const bad = ings.filter((i) => i.outcome !== 'handled');
  if (ok.length) return { kind: 'warn', title: `Handled by ${ok.length} of ${ings.length} ingresses`, small: `no handler at ${list(bad.map((i) => i.id))}` };
  const n = bad[0].handles.length;
  return { kind: 'warn', title: 'Arrives, no handler', small: n ? `handles ${plural(n, 'other event type')}, not this one` : 'its ingress lists no handler for it' };
}

export const uniqueIngresses = (rows) => {
  const seen = new Map();
  for (const r of rows) for (const i of r.ingresses) if (!seen.has(i.id)) seen.set(i.id, i);
  return [...seen.values()];
};

export const statusMark = (kind, title, small) => h('div.st', { class: kind },
  h('span.ic', { 'aria-hidden': 'true' }, { ok: '✓', warn: '!', maybe: '?' }[kind]),
  h('span.what', h('b', title), small ? h('small', small) : null));

const clickable = (el, open) => {
  el.setAttribute('tabindex', '0');
  el.setAttribute('role', 'button');
  el.addEventListener('click', (e) => { if (!e.target.closest('a')) open(); });
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } });
  return el;
};

/** `group` is null when no harvested service publishes the event type. */
export function producerNode(group, open, { possible = false } = {}) {
  if (!group) return h('div.lane-node.empty', 'No harvested service publishes it. Its producer\'s harvester may be missing.');
  const [first, ...rest] = group.callSites;
  return clickable(h('div.lane-node.svc', { 'aria-label': `${group.producer}, producer` },
    h('div.nm', wbr(group.producer)),
    h('div.sub-id', wbr(first.egress)),
    rest.length ? h('div.who', `and ${plural(rest.length, 'more call site')}`) : null,
    possible || group.possible ? h('span.possible-chip', { title: 'The event type is chosen at runtime' }, 'Possible') : null), open);
}

/** `rows`: the rows (one per queue) that reach this service. `outcome` is false when nothing delivers (no producer). */
export function consumerNode(service, rows, producer, open, { outcome = true } = {}) {
  const ings = uniqueIngresses(rows);
  const o = outcome ? outcomeOf(rows, producer) : null;
  return clickable(h('div.lane-node.svc', { class: o?.kind === 'warn' ? 'warn' : '', id: rows[0].id, 'aria-label': `${service}, consumer` },
    h('div.nm', wbr(service), ings.length > 1 ? h('span.badge', `${ings.length} ingresses`) : null),
    ings.slice(0, 3).map((i) => h('div.node-block',
      h('div.sub-id', wbr(i.id), i.handler ? [h('span.w', ' calls '), wbr(i.handler)] : h('span.w', ' has no handler for this type')),
      i.any && outcome ? h('div.handles', h('span.muted', 'handles'), h('span.all-chip', h('span.star', '*'), ' any type')) : null)),
    ings.length > 3 ? h('div.who', `+${ings.length - 3} more ingresses`) : null,
    rows.slice(1).map((r) => h('span.anchor', { id: r.id })),
    o ? statusMark(o.kind, o.title, o.small) : null), open);
}
