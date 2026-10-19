// Info panel for one line on the system map: who calls whom, how (transport, sync or async), and for
// each call behind the line the code on both sides, event types, subscription filters and, when it is
// broken, why. The code and event details load from the two services' views.

import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { href } from '../router.js';
import { chip, filterChips, filterText } from '../format.js';
import { section } from '../components/panel.js';
import { eventLink } from './inventory-links.js';

const MAX = 25;
const isSvc = (n) => n && (n.kind === 'service' || n.kind === 'gateway');

export const modeText = (modes) => (modes.includes('async') && modes.includes('sync') ? 'Sync and async' : modes.includes('async') ? 'Async' : 'Sync');

/** Returns [head, ...content] for panel.open(). */
export function edgePanel(e, byId, env) {
  const a = byId.get(e.from), b = byId.get(e.to);
  const name = (n, id) => (isSvc(n) ? h('a', { href: href(`/services/${encodeURIComponent(n.label)}`) }, n.label) : h('span', { class: n?.kind === 'missing' ? 'key' : '' }, n?.label ?? id));
  const head = h('div.stack', { style: { gap: '4px' } },
    h('h2', name(a, e.from), ' to ', name(b, e.to)),
    h('div.row', e.broken ? chip('broken', 'broken') : e.transports.filter((t) => t !== 'other').map((t) => chip(t)),
      h('span.pill', { title: 'Solid line: the caller waits for the answer. Dashed grey: fire and forget through a queue, topic or event.' }, e.broken ? 'no target' : modeText(e.modes)),
      h('span.xs.muted', `${e.endpoints.length} ${e.endpoints.length === 1 ? 'call' : 'calls'}`)));

  const detail = h('div.stack', { style: { gap: 'var(--s3)' } }, h('p.small.muted', 'Loading…'));
  const views = new Map();
  const view = (n) => (isSvc(n) ? (views.get(n.label) ?? views.set(n.label, api.service(env, n.label).catch(() => null)).get(n.label)) : Promise.resolve(null));
  Promise.all([view(a), view(b)]).then(([from, to]) => fill(detail, calls(e, a, b, from, to)))
    .catch((err) => fill(detail, h('p.small.muted', err.message)));
  return [head, detail];
}

function calls(e, a, b, from, to) {
  const rows = e.endpoints.slice(0, MAX).map((p) => callCard(e, p, from?.egress.find((x) => x.id === p.egress), to?.ingress.find((x) => x.id === p.ingress), b));
  return [
    e.broken ? h('p.small', 'Nothing matches the key these calls use. Either the target was renamed, or a harvester produced a different key on one side.') : null,
    section('Calls', e.endpoints.length, h('div.stack', { style: { gap: 'var(--s3)' } }, rows),
      e.endpoints.length > MAX ? h('p.xs.muted', `${e.endpoints.length - MAX} more. Open the service view to see all.`) : null)];
}

function callCard(e, p, eg, ing, b) {
  const status = !eg || !ing?.id ? null
    : eg.targets?.some((t) => t.service === ing.service && t.ingress === ing.id) ? null
    : eg.maybeTargets?.some((t) => t.service === ing.service && t.ingress === ing.id) ? 'maybe' : null;
  const via = p.via && p.via !== 'key' && p.via !== 'direct' && p.via !== 'none' ? p.via : null;
  const body = [];
  body.push(h('div.ep-pad.stack', { style: { gap: '2px' } }, h('span.ep-label', 'Key'), h('span.key', p.bindKey),
    via ? h('span.xs.muted', `via ${via}`) : null));
  if (eg) body.push(codeLine('Call site', eg.at, eg.id, eg.mode ? `${eg.mode}` : null));
  else if (p.egress) body.push(h('div.ep-pad.xs.muted', `Call ${p.egress}`));
  if (eg?.events?.length) body.push(h('div.ep-pad.stack', { style: { gap: '4px' } }, h('span.ep-label', 'Event types sent'),
    h('div.ep-producers', eg.events.map((t) => h('span.ep-producer', eventLink(t))))));
  if (p.filter) body.push(h('div.ep-pad.stack', { style: { gap: '4px' } }, h('span.ep-label', 'Subscription filter'),
    p.filter === '*' ? h('span.pill', 'all events') : h('div.ep-producers', filterChips(p.filter)), h('span.xs.muted', filterText(p.filter))));
  if (status) body.push(h('div.ep-pad', h('span.pill.warn', { title: 'An event type this caller sends is unknown, so it may or may not reach this handler.' }, 'maybe: event type unknown')));
  if (ing) body.push(codeLine('Handled by', ing.at, ing.handler, b?.label));
  else if (p.ingress) body.push(h('div.ep-pad.xs.muted', `Ingress ${p.ingress}`));
  for (const u of eg?.unresolved ?? []) body.push(h('div.ep-pad.stack', { style: { gap: '2px' } }, h('span.ep-label', 'Unresolved by the harvester'),
    h('span.pill.gap', `${u.what}: ${u.reason}`), u.detail ? h('span.key', u.detail) : null,
    u.candidates?.length ? h('span.xs.muted', `candidates: ${u.candidates.join(', ')}`) : null));
  const prov = eg?.provenance ?? ing?.provenance;
  if (prov) body.push(h('div.ep-pad.xs.muted', 'Harvested by ', [prov.producer, prov.verified ? `(${prov.verified})` : null].filter(Boolean).join(' ')));
  return h('section.ep-card', h('header', h('h3', { class: 'truncate' }, `${p.from} to ${p.to}`)), body);
}

function codeLine(label, at, fn, sub) {
  const loc = at?.file ? `${at.file}${at.line ? ':' + at.line : ''}` : 'no file recorded';
  const text = h('span.ep-link-text', h('span.ep-label', label), h('b', fn), h('span.key', loc), sub ? h('span.xs.muted', sub) : null);
  return at?.url ? h('a.ep-link', { href: at.url, target: '_blank', rel: 'noopener noreferrer', title: at.url }, text, icon('external')) : h('div.ep-link.disabled', text);
}
