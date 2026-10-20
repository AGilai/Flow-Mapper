// The side panel of the event page: a consumer shows one card per ingress (handler code and status),
// a producer one card per call site, with the candidates when it only may send the event type.
// Same cards as the endpoint panel. Returns [head, ...content] for panel.open().

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { href } from '../router.js';
import { filterLabel } from '../../core/glob.js';
import { serviceLink } from './inventory-links.js';
import { statusMark, uniqueIngresses } from '../components/event-nodes.js';
import { viaChip, callSitesList } from '../components/via-chip.js';

const where = (at) => (at?.file ? `${at.file}${at.line ? ':' + at.line : ''}` : at?.repo ?? null);
const external = (url) => ({ href: url, target: '_blank', rel: 'noopener noreferrer', title: url });
const card = (title, meta, ...body) => h('section.ep-card', h('header', h('h4', title), meta ? h('span.ep-meta', meta) : null), ...body);
const link = (bold, key, url) => (url
  ? h('a.ep-link', external(url), h('span.ep-link-text', h('b', bold), key ? h('span.key', key) : null), icon('external'))
  : h('div.ep-link.disabled', h('span.ep-link-text', h('b', bold), key ? h('span.key', key) : null)));
const head = (name, chip, sub) => h('div.grow', h('h3', serviceLink(name), chip), h('div.sub', sub));
const actions = (...btns) => h('div.panel-actions', btns);
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Every visible row that reaches `service`, with the producer and target it came from. */
const entriesFor = (flow, service) => flow.groups.flatMap((g) => g.targets.flatMap((t) => t.rows
  .filter((r) => r.consumer === service && r.outcome !== 'filtered').map((r) => ({ g, t, r }))));

export function consumerPanel(flow, service) {
  const entries = entriesFor(flow, service);
  const ings = uniqueIngresses(entries.map((e) => e.r));
  const route = (e) => [
    e.r.queue ? ['from ', h('span.mono', e.r.queue.name)] : ['from ', h('span.mono', e.t.topic?.name)],
    e.t.topic ? `, through ${[e.t.topic.name, ...e.r.via].join(' and ')} by ${e.g.producer}` : `, sent directly by ${e.g.producer}`,
  ];
  const cards = ings.map((i) => {
    const mine = entries.filter((e) => e.r.ingresses.some((x) => x.id === i.id));
    const maybe = mine.every((e) => e.r.outcome === 'possible');
    const state = maybe ? ['maybe', 'Possible', `${mine[0].r.ifSent === 'handled' ? 'handled' : 'arrives with no handler'}, if ${mine[0].g.producer} sends it`]
      : i.outcome === 'handled' ? ['ok', 'Handled', filterNote(mine)]
      : ['bad', 'Arrives, no handler', i.handles.length ? `handles ${plural(i.handles.length, 'other event type')}, not this one. Add it to ${i.id} or filter it out of the subscription.` : null];
    return card(i.id, i.bindKey,
      h('div.ep-route', mine.flatMap((e, k) => [k ? ' and ' : null, route(e)])),
      i.handler
        ? link(i.handler, where(i.code), i.code?.url)
        : h('div.ep-route', 'Its ingress calls ', h('span.mono', i.ingressHandler), ' and lists no handler for this event type.'),
      statusMark(...state));
  });
  const ways = new Set(entries.map((e) => (e.t.topic ? 'topic' : 'direct')));
  const trace = ings.find((i) => i.outcome === 'handled') ?? ings[0];
  return [
    head(service, null, `Consumer of ${flow.type} · ${plural(ings.length, 'ingress', 'ingresses')}`),
    h('div.panel-section-t', 'Where it arrives', h('span', ings.length > 1 ? 'one card per ingress' : null)),
    ...cards,
    ways.size > 1 ? h('p.ep-note', `${service} gets this event both ways: sent directly and through a topic.`) : null,
    actions(trace ? h('a.btn.primary', { href: href('/flows', { service, ingress: trace.id, event: flow.type }) }, icon('flow'), 'Trace from here') : null,
      h('a.btn', { href: href(`/services/${encodeURIComponent(service)}`) }, `Open ${service}`)),
  ];
}

const filterNote = (mine) => {
  const f = mine.map((e) => e.r.filter).find((x) => x && !(x.agree && x.events === '*'));
  return f ? `the subscription lets through ${filterLabel(f.events)}` : null;
};

export function producerPanel(flow, service) {
  const g = flow.groups.find((x) => x.producer === service);
  const bad = new Map(flow.unresolved.filter((u) => u.service === service).map((u) => [u.egress, u]));
  const cards = g.callSites.map((c) => {
    const to = c.to.length ? c.to.map((n) => `${/queue/.test(n.kind) ? 'directly to' : 'to'} ${n.name}`).join(', ') : null;
    return card(c.egress, to,
      link(c.fn ?? where(c.at) ?? c.bindKey, c.fn ? where(c.at) : null, c.at?.url),
      viaChip(c.via.via) || callSitesList(c.via.callSites) ? h('div.ep-pad.stack', { style: { gap: 'var(--s1)' } }, viaChip(c.via.via), callSitesList(c.via.callSites)) : null,
      c.possible ? [
        h('div.ep-route', `The type is chosen at runtime. The harvester lists ${plural(c.candidates.length, 'candidate')}:`),
        h('div.cand', c.candidates.map((t) => h('span.ev-chip.possible', { class: t === flow.type ? 'this' : '' }, t))),
      ] : null,
      bad.has(c.egress) ? h('p.ep-note.ep-pad', `Target not resolved by the harvester: ${bad.get(c.egress).reason}.`) : null);
  });
  return [
    head(service, g.possible ? h('span.possible-chip', 'Possible') : null, `${g.possible ? 'May produce' : 'Producer of'} ${flow.type} · ${plural(cards.length, 'call site')}`),
    ...cards,
    g.possible ? h('p.ep-note', 'Possible is not a problem: the routes are drawn so you can see where it would go.') : null,
    actions(h('a.btn', { href: href(`/services/${encodeURIComponent(service)}`) }, `Open ${service}`)),
  ];
}
