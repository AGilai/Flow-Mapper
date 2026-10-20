// Side panel for one arrow in a flow's sequence diagram: where the call is made (function, file and
// line, step), who handles it (handler, or the data store), and its DTO: the event's message, the
// endpoint's request/response body or queue message, or the data store's schema. The DTO part loads
// on demand.

import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { icon } from '../icons.js';
import { href } from '../router.js';
import { ago, chip } from '../format.js';
import { section } from '../components/panel.js';
import { jsonView } from '../components/json-view.js';
import { dtoSource } from '../components/dto-source.js';
import { viaChip } from '../components/via-chip.js';
import { stepFields } from '../components/step-fields.js';
import { eventLink, serviceLink, storeLink } from './inventory-links.js';

const KIND = { entry: 'Entry', call: 'Function call', egress: 'Call', deliver: 'Delivery from queue', resource: 'Data store access', leaf: 'Leaf step (classified by the harvester)', frontier: 'Frontier steps (folded)' };

/** Returns [head, ...content] for panel.open(). */
export function messagePanel(m, trace, env) {
  const p = (id) => trace.participants.find((x) => x.id === id);
  const kind = m.kind === 'egress' && m.mode === 'async' ? 'Publish / async call' : KIND[m.kind];
  const head = h('div.ep-head',
    h('div.ep-title', m.transport && m.transport !== 'res' ? chip(m.transport) : null, h('span.ep-target', kind)),
    h('div.ep-sub', h('span.key', m.label), m.event ? eventLink(m.event) : null));

  const dto = h('div.stack', { style: { gap: 'var(--s3)' } }, h('p.small.muted', 'Loading…'));
  loadDto(m, env).then((cards) => fill(dto, cards)).catch((err) => fill(dto, h('p.small.muted', err.message)));

  return [head,
    m.gap ? gapCard(m.gap) : null,
    codeCard(m, trace),
    m.gap ? null : dto,
    m.unhandled ? section('Why it is broken', null, h('p.small', `${m.event} reaches this consumer, but none of its event handlers matches it. It will fail or go to the dead-letter queue.`))
      : m.broken ? section('Why it is broken', null, h('p.small', 'No ingress, queue or route matches this key. Either the target was renamed, or a harvester produced a different key on one side.')) : null,
    m.origin === 'frontier' ? h('p.small.muted', 'A frontier step: part of a call tree that reaches no sink.') : null,
    m.cycle ? h('p.small.muted', 'This call leads back into a function already on the path, so the trace stops here.') : null,
    h('dl.kv',
      h('dt', 'From'), h('dd', p(m.from)?.label ?? m.from),
      h('dt', 'To'), h('dd', { class: m.broken ? 'key' : '' }, p(m.to)?.label ?? m.to),
      h('dt', 'Mode'), h('dd', m.mode),
      h('dt', 'Depth'), h('dd', String(m.depth)),
      ...(m.delivery ? [h('dt', 'Delivery'), h('dd', `${m.depth}.${m.delivery}`)] : []),
      ...(m.matched?.length ? [h('dt', 'Delivered as'), h('dd', m.matched.map((t) => eventLink(t)), h('span.xs.muted', ' the publish names no event; these types of it pass the subscription filter'))] : []),
      ...(m.deliveries ? [h('dt', 'Deliveries'), h('dd', `fans out to ${m.deliveries}`)] : []))];
}

// ---- a call the harvester could not resolve ----

function gapCard(u) {
  return h('section.ep-card', h('header', h('h3', 'Unresolved by the harvester'), h('span.ep-meta', h('span.pill.gap', u.reason))),
    h('div.ep-pad.stack', { style: { gap: 'var(--s1)' } },
      u.detail ? h('span.key', u.detail) : null,
      u.candidates?.length ? [h('span.ep-label', 'Candidates'), h('div.ep-producers', u.candidates.map((c) => h('span.ep-producer', h('span.key', c))))] : null,
      h('p.ep-note', 'The harvester found this call in code but could not tell where it goes, so the flow stops here.')));
}

// ---- code: caller and callee ----

function codeCard(m, trace) {
  const at = (service, fn) => trace.code?.[`${service}:${fn}`] ?? null;
  const rows = [];
  if (m.kind !== 'entry' && m.service && m.fn) {
    const step = [m.seq ? `step ${m.seq}` : null, m.condition ? `only if ${m.condition}` : null, m.alt ? `alternative ${m.alt.branch} of ${m.alt.of}` : null, m.loop ? 'in a loop' : null].filter(Boolean).join(', ');
    rows.push(codeRow('Called from', m.service, m.fn, at(m.service, m.fn), step || null));
  }
  if (m.calls) rows.push(codeRow('Calls', m.service, m.calls, at(m.service, m.calls)));
  if (m.target?.fn) rows.push(codeRow(m.kind === 'entry' ? 'Handled by' : 'Runs', m.target.service, m.target.fn, at(m.target.service, m.target.fn), `ingress ${m.target.ingress}`));
  const stepAt = m.seq ? trace.code?.[`step:${m.service}:${m.fn}#${m.seq}`] : null;
  if (stepAt) rows.push(codeRow("Called at", m.service, m.fn, stepAt, m.seq ? `step ${m.seq}` : null));
  const callSite = m.egress ? trace.code?.[`egress:${m.service}:${m.egress}`] : null;
  if (callSite) rows.push(codeRow('Call site', m.service, m.egress, callSite));
  if (m.via?.length) rows.push(h('div.ep-pad.stack', { style: { gap: 'var(--s1)' } }, h('span.ep-label', 'Goes through'), viaChip(m.via)));
  if (m.handlerVia?.length) rows.push(h('div.ep-pad.stack', { style: { gap: 'var(--s1)' } }, h('span.ep-label', 'Handler resolved through'), viaChip(m.handlerVia)));
  if (m.store) rows.push(h('div.ep-pad.stack', { style: { gap: '2px' } }, h('span.ep-label', 'Data store'), storeLink(m.store)));
  if (m.fields?.length) rows.push(h('div.ep-pad.stack', { style: { gap: '2px' } }, h('span.ep-label', 'Fields'), stepFields(m.fields)));
  if (m.note) rows.push(h('p.ep-note.ep-pad', m.note));
  if (m.eventFrom) rows.push(h('p.ep-note.ep-pad', m.eventFrom.boundAt
    ? `Event from caller ${m.eventFrom.boundAt}: bind ${m.eventFrom.name}=${m.event}`
    : `Event type is the caller's "${m.eventFrom.name}", but no caller on this path binds it, so the publish is treated as naming no event.`));
  return rows.length ? h('section.ep-card', h('header', h('h3', 'Code')), rows) : null;
}

function codeRow(label, service, fn, source, sub = null) {
  const loc = source?.file ? `${source.file}${source.line ? ':' + source.line : ''}` : 'no file recorded';
  const text = h('span.ep-link-text', h('span.ep-label', label), h('b', fn), h('span.key', loc), h('span.xs.muted', service, sub ? ` · ${sub}` : ''));
  return source?.url
    ? h('a.ep-link', { href: source.url, target: '_blank', rel: 'noopener noreferrer', title: source.url }, text, icon('external'))
    : h('div.ep-link.disabled', text);
}

// ---- DTO: event message, endpoint body, or store schema ----

const card = (label, meta, ...content) => h('section.ep-card', h('header', h('h3', label), meta ? h('span.ep-meta', meta) : null), ...content);
const emptyDto = (text, hint) => h('div.ep-empty', h('p', text), hint ? h('code.key', hint) : null);

async function loadDto(m, env) {
  if (m.event) {
    const t = await api.eventType(env, m.event);
    return [card(`Message · ${m.event}`, t.dto ? `updated ${ago(t.dto.updatedAt)}` : null,
      t.dto ? [dtoSource(t.dto), jsonView(t.dto.content)] : emptyDto('No message DTO for this event type yet.', `PUT /api/envs/${env}/event-dtos/${m.event}`))];
  }
  if (m.gap) return [];
  if (m.target && !m.unhandled) {
    const info = await api.endpoint(env, m.target.service, m.target.ingress);
    if (info.events.length) {
      return [h('p.small.muted', 'This consumer takes typed events; this call carries no event type. ',
        h('a', { href: href(`/services/${encodeURIComponent(m.target.service)}`, { ep: m.target.ingress }) }, 'See its event types'))];
    }
    return [...info.slots.map((s) => card(s.label, s.dto ? `updated ${ago(s.dto.updatedAt)}` : null,
      s.dto ? [dtoSource(s.dto), jsonView(s.dto.content)] : emptyDto(`No ${s.label.toLowerCase()} loaded yet.`, `PUT /api/envs/${env}/dtos/${m.target.service}/${s.role}/${m.target.ingress}`))),
      info.note ? h('p.ep-note', info.note) : null];
  }
  if (m.store) {
    const st = await api.store(env, m.store);
    return st.schemas.length
      ? st.schemas.map((s) => card(`Schema · from ${s.source}`, `updated ${ago(s.updatedAt)}`, jsonView(s.content)))
      : [card('Schema', null, emptyDto('No schema for this data store yet.', `PUT /api/envs/${env}/schemas/code/${m.store}`))];
  }
  return [];
}
