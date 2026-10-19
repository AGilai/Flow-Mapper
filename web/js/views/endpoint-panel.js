// Info panel for one ingress endpoint: where its code starts in the repo, and its DTOs, named for
// the kind of endpoint (a queue's message, a POST's request body, a GET's response body). An event
// consumer lists each event type with its handler, producers and Message DTO.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { href } from '../router.js';
import { ago, chip, splitKey } from '../format.js';
import { jsonView } from '../components/json-view.js';
import { eventPath } from './inventory-links.js';

/** Returns [head, ...content] for panel.open(). */
export function endpointPanel(info, env) {
  const { service, ingress: i, method, handler: fn, source } = info;
  const target = i.details?.path ?? splitKey(i.bindKey).rest.replace(/^[A-Z]+\s+/, '');
  const head = h('div.ep-head',
    h('div.ep-title', method ? h('span.ep-method', { 'data-m': method }, method) : chip(i.transport), h('span.ep-target', target)),
    h('div.ep-sub', h('span', service), method ? chip(i.transport) : null, i.entryPoint ? h('span.pill', 'entry point') : null));

  return [head, codeCard(fn, i, source, info.definedAt), ...info.slots.map((s) => dtoCard(s, env, service, i.id)),
    info.events.length ? eventsSection(info, env) : null,
    info.note ? h('p.ep-note', info.note) : null,
    h('a.btn.primary.ep-trace', { href: href('/flows', { service, ingress: i.id }) }, icon('flow'), 'Trace from here')];
}

function codeCard(fn, i, source, definedAt) {
  const loc = fn?.file ? `${fn.file}${fn.line ? ':' + fn.line : ''}` : null;
  const ref = source && (source.ref === 'HEAD' ? 'default branch' : source.ref);
  const body = source?.url
    ? h('a.ep-link', { href: source.url, target: '_blank', rel: 'noopener noreferrer', title: source.url },
        h('span.ep-link-text', h('b', fn?.name ?? i.handler), h('span.key', loc ?? source.repo)), icon('external'))
    : h('div.ep-link.disabled', h('span.ep-link-text', h('b', fn?.name ?? i.handler), h('span.key', loc ?? 'no file recorded')));
  const verified = i.provenance?.verified;
  const route = definedAt?.url ? h('a.ep-link', { href: definedAt.url, target: '_blank', rel: 'noopener noreferrer', title: definedAt.url },
    h('span.ep-link-text', h('span.ep-label', 'Route declared at'), h('span.key', `${definedAt.file ?? definedAt.url}${definedAt.line ? ':' + definedAt.line : ''}`)), icon('external')) : null;
  const gap = i.unresolved?.find((u) => u.what === 'target');
  return card('Code', h('span.ep-meta', verified ? h('span.pill', { class: `verified-${verified}`, title: `checked against the live system: ${verified}` }, verified) : null, ref ? [icon('commit'), ref] : null),
    body, route,
    gap ? h('p.ep-note.ep-pad', `Unresolved by the harvester: ${gap.reason}${gap.detail ? ` (${gap.detail})` : ''}.`) : null,
    source ? null : h('p.ep-note', 'No repository recorded for this service.'));
}

function dtoCard(slot, env, service, ingress) {
  const d = slot.dto;
  const meta = d ? h('span.ep-meta', slot.stale ? h('span.pill.warn', { title: 'Loaded before the service was last harvested' }, 'may be out of date') : null, `updated ${ago(d.updatedAt)}`) : null;
  return card(slot.label, meta, d ? jsonView(d.content) : h('div.ep-empty',
    h('p', `No ${slot.label.toLowerCase()} loaded yet.`),
    h('code.key', `PUT /api/envs/${env}/dtos/${service}/${slot.role}/${ingress}`)));
}

const card = (label, meta, ...content) => h('section.ep-card', h('header', h('h3', label), meta), ...content);

// ---- event types ----

const STATUS = {
  unhandled: ['bad', 'no handler', 'Arrives here, but no handler matches it. Handle it in the ingress events, or filter it out in the subscription.'],
  never: ['warn', 'nothing sends it', 'Handled here, but no harvested service publishes it on a route into this queue, and no producer is declared.'],
  possible: ['', 'possible', 'A producer may send it: the type is one of its candidates, not confirmed.'],
  'declared-only': ['', 'declared producers only', 'Only producers declared by this consumer; Flow-Mapper does not harvest them, so the route is not verified.'],
  ok: null,
};

function eventsSection(info, env) {
  const open = info.events.length === 1; // several types: collapsed cards, one header each
  return h('section.ep-events',
    h('h3.ep-events-title', 'Event types', h('span.muted', String(info.events.length))),
    info.events.map((e) => eventCard(e, info, env, open)));
}

function eventCard(e, info, env, open) {
  const st = STATUS[e.status];
  const meta = h('span.ep-meta',
    st ? h('span.pill', { class: st[0] }, st[1]) : null,
    e.dto ? h('span', 'DTO') : null);
  const handler = e.handler
    ? (e.source?.url
      ? h('a.ep-link', { href: e.source.url, target: '_blank', rel: 'noopener noreferrer', title: e.source.url },
          h('span.ep-link-text', h('b', e.handler), h('span.key', e.source.file ? `${e.source.file}${e.source.line ? ':' + e.source.line : ''}` : e.source.repo)), icon('external'))
      : h('div.ep-link.disabled', h('span.ep-link-text', h('b', e.handler))))
    : null;
  return h('details.ep-card.ep-event', { open },
    h('summary', h('span.ep-event-name.key', e.type), e.pattern ? h('span.xs.muted', `via ${e.pattern}`) : null, meta),
    st ? h('p.ep-note.ep-pad', st[2]) : null,
    handler,
    h('div.ep-pad.stack', { style: { gap: 'var(--s1)' } },
      h('span.ep-label', 'Producers'),
      e.producers.length ? h('div.ep-producers', e.producers.map(producerChip)) : h('span.small.muted', 'None found.')),
    e.type.includes('*') ? null : h('div.ep-pad.stack', { style: { gap: 'var(--s1)' } },
      h('span.ep-label', 'Message', e.dto ? h('span.muted', ` · updated ${ago(e.dto.updatedAt)}`) : null),
      e.dto ? jsonView(e.dto.content) : h('div.ep-empty', h('p', 'No message DTO for this event type yet.'), h('code.key', `PUT /api/envs/${env}/event-dtos/${e.type}`))),
    e.type.includes('*') ? null : h('div.ep-pad.row', { style: { gap: 'var(--s2)' } },
      e.handler ? h('a.btn.ghost', { href: href('/flows', { service: info.service, ingress: info.ingress.id, event: e.type }) }, icon('flow'), `Trace ${e.type}`) : null,
      h('a.btn.ghost', { href: href(eventPath(e.type)) }, 'Open event type')));
}

function producerChip(p) {
  const tag = p.possible ? 'possible' : p.derived && p.declared ? 'confirmed'
    : p.declared && p.harvested ? 'declared, not seen'
    : p.declared ? 'declared, not harvested' : null;
  const cls = p.possible ? 'declared' : p.declared && p.harvested && !p.derived ? 'warn' : p.declared && !p.derived ? 'declared' : '';
  const title = p.derived ? 'Found from harvested data' : p.harvested ? 'Declared by the consumer, but this service does not send it here' : 'Declared by the consumer; Flow-Mapper does not harvest this service';
  return h('span.ep-producer', { class: cls, title },
    p.harvested ? h('a', { href: href(`/services/${encodeURIComponent(p.service)}`) }, p.service) : h('span', p.service),
    p.egress ? h('span.key.muted', p.egress) : null,
    tag ? h('span.xs.muted', tag) : null);
}
