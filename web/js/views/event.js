// Event type page: who publishes it and where, every delivery (route, consumer, handler), its problems
// and its Message DTO.

import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { href } from '../router.js';
import { ago } from '../format.js';
import { pageHead } from '../components/page.js';
import { jsonView } from '../components/json-view.js';
import { icon } from '../icons.js';
import { box, empty, fig, problems } from './detail-parts.js';
import { channelLink, serviceLink } from './inventory-links.js';

export async function render({ main, params }) {
  const v = await api.eventType(state.env, params.type);
  const p = v.problems ?? { unhandled: [], undelivered: [], neverArrives: [], declaredNotSeen: [] };
  const issues = [
    ...p.unhandled.map((d) => `${d.consumer.service} receives it from ${d.producer.service} but has no handler for it.`),
    ...p.undelivered.map((d) => `${d.service} publishes it to ${d.bindKey}, but every subscription filters it out.`),
    ...p.neverArrives.map((d) => `${d.service} handles it, but nothing sends it there.`),
    ...p.declaredNotSeen.map((d) => `${d.service} declares ${d.producer} as a producer, but ${d.producer} does not send it there.`),
  ];
  const deliveries = v.deliveries ?? [];

  main.append(
    pageHead(v.type, 'Event type',
      h('a.btn', { href: href('/inventory', { type: 'event' }) }, 'All event types')),
    h('div.content', h('div.page-grid',
      h('div.figures', fig(v.producers.length, 'Producers'), fig(v.consumers.length, 'Consumers'), fig(deliveries.length, 'Routes'),
        fig(issues.length, 'Problems', issues.length > 0), fig(v.dto ? 'yes' : 'no', 'Message DTO')),
      problems(issues),
      h('div.two-col',
        h('div.stack', { style: { gap: 'var(--s4)' } },
          box('Published by', v.producers.length, v.producers.length ? v.producers.map((x) => h('div.use',
            h('div.use-head', h('b', serviceLink(x.service)), h('span.key.muted', x.egress))))
            : empty('No harvested service publishes it.')),
          box('Routes', deliveries.length, deliveries.length ? deliveries.map((d) => h('div.use',
            h('div.route', serviceLink(d.producer.service), d.via.flatMap((k) => [h('span.sep', '→'), channelLink(k)]), h('span.sep', '→'), h('b', serviceLink(d.consumer.service)),
              d.handler ? h('span.key.muted', d.handler) : h('span.pill.bad', 'no handler')),
            d.handler ? h('a.small', { href: href('/flows', { service: d.consumer.service, ingress: d.consumer.ingress, event: v.type }) }, icon('flow'), ' Trace from this consumer') : null))
            : empty('It reaches no consumer.'))),
        h('div.stack', { style: { gap: 'var(--s4)' } },
          box('Message', null, v.dto
            ? [h('span.xs.muted', `updated ${ago(v.dto.updatedAt)}`), jsonView(v.dto.content)]
            : h('div.ep-empty', h('p', 'No message DTO yet.'), h('code.key', `PUT /api/envs/${state.env}/event-dtos/${v.type}`))),
          box('Consumers', v.consumers.length, v.consumers.length ? h('div.list', v.consumers.map((c) => h('div.list-item',
            serviceLink(c.service), h('span.grow.truncate.key.muted', c.ingress), c.handler ? h('span.xs.key', c.handler) : h('span.pill.bad', 'no handler'))))
            : empty('No consumer.')))))));
}
