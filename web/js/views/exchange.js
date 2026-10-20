// RabbitMQ exchange page (0.19.0), reached through #/instances/amqp%3A<name> like a Redis instance: head, verdict with callouts,
// who publishes which routing keys, which bindings route them where, and a box that tests a routing key with the same rules the
// server uses (core/glob.js keyMatches: topic, exact, glob; a fanout exchange routes to every binding). See design/mockups/rabbitmq.html frame 3.

import { h } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { href } from '../router.js';
import { pageHead } from '../components/page.js';
import { objectIcon } from '../components/object-icon.js';
import { VERIFIED } from '../components/declaration.js';
import { routesTo } from '../../core/amqp-exchange.js';
import { codeLink } from './detail-parts.js';
import { channelPath, serviceLink } from './inventory-links.js';
import { monoText } from '../format.js';

const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const list = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : xs[0] ?? '');
const where = (at) => (at?.url ? codeLink(`${(at.file ?? 'source').split('/').pop()}${at.line ? ':' + at.line : ''}`, at) : null);

function meta(v) {
  const d = v.definition;
  const others = v.declaredBy.filter((s) => s !== d?.service);
  return h('span.ex-meta',
    h('span.meta', h('span.key', v.key),
      d ? h('span', 'Defined by ', h('b', d.service), where(d.source) ? [' in ', where(d.source)] : null, others.length ? `; ${plural(others.length, 'more service')} declare${others.length === 1 ? 's' : ''} it too` : null)
        : h('span', 'Not declared by an infra harvester: found from ', list(v.services)),
      d?.verified ? h('span', { class: `verified-${d.verified}` }, VERIFIED[d.verified] ?? d.verified) : null),
    h('span.meta', h('span', 'vhost ', h('b.ex-key', v.vhost ?? '/')), v.durable != null ? h('span', h('b', v.durable ? 'durable' : 'transient')) : null,
      v.alternateExchange ? h('span', 'alternate exchange ', h('a.ex-key', { href: href(`/instances/${encodeURIComponent('amqp:' + v.alternateExchange)}`) }, v.alternateExchange)) : h('span', 'no alternate exchange')));
}

function lead(v) {
  const p = v.publisherServices, k = v.routingKeys;
  const pub = p ? [h('b', plural(p, 'service')), ` ${p === 1 ? 'publishes' : 'publish'} `, h('b', plural(k, 'routing key')), ` to ${v.name}. `] : `No harvested service publishes to ${v.name}. `;
  const route = v.bindingCount
    ? [h('b', plural(v.bindingCount, 'binding')), ` ${v.bindingCount === 1 ? 'routes' : 'route'} ${p ? 'them' : 'messages'} to ${plural(v.queues, 'queue')}`,
      v.consumerServices.length ? `, read by ${plural(v.consumerServices.length, 'service')}.` : ', none read by a harvested service.']
    : 'It has no bindings, so every message is dropped.';
  return [pub, route];
}

const anchor = (kind, service, id) => `ex-${kind}-${encodeURIComponent(service)}-${encodeURIComponent(id)}`.replace(/%/g, '_P'); // encoded, so two ids never collide
const show = (id) => (e) => {
  e.preventDefault();
  const el = document.getElementById(id);
  el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el?.classList.add('flash');
  setTimeout(() => el?.classList.remove('flash'), 1600);
};

function publishers(v) {
  const rows = [];
  let last = null;
  for (const p of v.publishers) {
    const first = p.service !== last;
    last = p.service;
    const n = v.publishers.filter((x) => x.service === p.service).length;
    rows.push(h('tr', { id: anchor('pub', p.service, p.id) },
      first ? h('td.ex-svc', { rowSpan: n }, serviceLink(p.service)) : null,
      h('td.ex-key', p.routingKey || '(none)'),
      p.dropped ? h('td.ex-warn', h('b', 'Matches nothing. '), p.alternateExchange ? `Goes to the alternate exchange ${p.alternateExchange}.` : 'Dropped: the exchange has no alternate exchange.')
        : h('td', plural(p.reaches.length, 'binding'), ': ', p.reaches.flatMap((r, i) => [i ? ', ' : '', h('span.ex-key', r.key), r.possible ? h('span.xs.muted', ' (if its headers match)') : null])),
      h('td.xs', p.publishedIn.length ? p.publishedIn.map((f, i) => [i ? ', ' : '', h('a', { href: href('/flows', { service: p.service, fn: f.fn, scope: 'intra' }) }, f.name)]) : where(p.at) ?? h('span.muted', 'not reported'))));
  }
  return h('section.flow-section', h('header', h('h2', 'Publishers ', h('small.muted', `${plural(v.publisherServices, 'service')}, ${plural(v.routingKeys, 'routing key')}`)), h('span.hint', 'service → routing key → what it reaches')),
    v.publishers.length ? h('div.ex-scroll', h('table.ex-t', h('thead', h('tr', ['Service', 'Routing key', 'Reaches', 'Published in'].map((t) => h('th', t)))), h('tbody', rows)))
      : h('p.lane-note', 'No harvested service publishes to this exchange.'));
}

function bindings(v) {
  const trs = v.bindings.map((b) => h('tr', { id: anchor('bind', b.service, b.id), 'data-id': `${b.service}/${b.id}` },
    h('td.ex-key', b.key), h('td.ex-arrow', '→'), h('td', h('a.ex-key', { href: href(channelPath(b.queueKey)) }, b.queue)),
    h('td', b.consumers.length ? b.consumers.map((c) => h('div', serviceLink(c.service), ' ', h('span.ex-key.xs', c.handler))) : h('span.muted', 'no harvested consumer')),
    b.noPublisher ? h('td.ex-warn', h('b', 'No harvested publisher sends a key this binding matches.'))
      : h('td.ex-mlist', b.matchedBy.map((m) => h('code', { title: m.service }, m.routingKey)))));
  const out = h('output', { for: 'ex-rk' });
  const input = h('input#ex-rk', { value: '', placeholder: v.type === 'fanout' ? 'any key' : 'device.ab12.logout', spellcheck: false, autocomplete: 'off', 'aria-label': 'Routing key to test' });
  const test = () => {
    const key = input.value.trim(), hit = key ? routesTo(v, key) : null;
    trs.forEach((tr) => { tr.classList.toggle('hit', !!hit?.has(tr.dataset.id)); tr.classList.toggle('miss', !!key && !!hit && !hit.has(tr.dataset.id)); });
    out.textContent = !key ? '' : !hit ? 'A headers exchange routes by message headers, not by key.' : hit.size ? `matches ${hit.size} of ${v.bindings.length} bindings` : v.alternateExchange ? `matches no binding: goes to ${v.alternateExchange}` : 'matches no binding: dropped';
    out.classList.toggle('none', !!hit && !hit.size);
  };
  input.addEventListener('input', test);
  const sample = v.publishers.find((p) => !p.dropped && p.routingKey)?.routingKey; // start from a real published key, its {placeholders} as one word
  if (sample) { input.value = sample.replace(/\{[^}]*\}/g, 'ab12'); test(); }
  const rule = v.type === 'fanout' ? 'Fanout: every binding gets every message.' : v.type === 'direct' ? 'Direct: the binding key must equal the routing key.'
    : v.type === 'headers' ? 'Headers: routed by message headers.' : '* is exactly one word, # is zero or more.';
  return h('section.flow-section', h('header', h('h2', 'Bindings ', h('small.muted', String(v.bindings.length))),
    h('div.ex-tester', h('label', { for: 'ex-rk' }, 'Test a routing key'), input, out)),
    v.bindings.length ? h('div.ex-scroll', h('table.ex-t#ex-bindings', h('thead', h('tr', ['Binding key', '', 'Queue', 'Consumer · handler', 'Matched by'].map((t) => h('th', t)))), h('tbody', trs)))
      : h('p.lane-note', 'No harvested service binds a queue to this exchange.'),
    h('div.ex-foot', v.bindings.length ? `Bindings declared by ${list([...new Set(v.bindings.map((b) => b.service))])}. ${rule} Queue names open their pages.` : rule));
}

export async function render({ main, params }, loaded) {
  const v = loaded ?? await api.instance(state.env, params.key);
  const callouts = v.callouts.map((c) => {
    const [service, ...id] = c.row.id.split('/');
    return h('div.callout', h('span.dot'), h('span.grow', monoText(c.text)),
      h('button.btn.ghost.sm', { type: 'button', on: { click: show(anchor(c.row.type === 'publisher' ? 'pub' : 'bind', service, id.join('/'))) } }, 'Show the row'));
  });
  const head = pageHead(h('span.title-row', h('span.titled', objectIcon('channel', 'amqp-exchange', 26), h('span', v.name)),
    h('span.ex-kind', `AMQP ${v.type ?? 'unknown type'} exchange`)), meta(v), h('a.btn', { href: href('/inventory', { type: 'amqp', kind: 'amqp-exchange' }) }, 'All exchanges'));
  main.append(head, h('div.content', h('div.ri-page.ex-page',
    h('div.verdict', h('p.lead', lead(v)), callouts.length ? h('div.callouts', callouts) : null),
    publishers(v), bindings(v))));
}
