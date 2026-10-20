// The RPC part of the endpoint panel (0.19.0): the callers of an RPC command, each with its function, source link and timeout
// (callers often differ), and the server's side of the command queue. See design/mockups/rabbitmq.html frame 5.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { href } from '../router.js';

const seconds = (ms) => (ms % 1000 ? `${ms} ms` : `${ms / 1000} s`);
const card = (label, count, ...content) => h('section.ep-card', h('header', h('h3', label, count != null ? h('span.muted', ` ${count}`) : null)), ...content);
const kv = (k, ...v) => [h('dt', k), h('dd', v)];

export function rpcCards(rpc, service) {
  const callers = rpc.callers.length
    ? h('div.rpc-callers', rpc.callers.map((c) => h('div.rpc-caller',
      h('a.b', { href: href(`/services/${encodeURIComponent(c.service)}`) }, c.service),
      c.timeoutMs != null ? h('span.muted', `timeout ${seconds(c.timeoutMs)}`) : h('span.muted', 'timeout not reported'),
      c.fn ? h('a.key', { href: href('/flows', { service: c.service, fn: c.fn.id, scope: 'intra' }) }, c.fn.name) : null,
      c.source?.url ? h('a.at-link', { href: c.source.url, target: '_blank', rel: 'noopener noreferrer', title: c.source.url }, `${(c.source.file ?? 'source').split('/').pop()}${c.source.line ? ':' + c.source.line : ''}`, icon('external')) : null)))
    : h('p.ep-note', 'No harvested service calls this command. Callers may be outside the harvest; the server works without them.');
  const plumbing = h('dl.rpc-kv',
    rpc.commandQueue ? kv('Command queue', h('span.key', rpc.commandQueue), h('small', [rpc.prefetch != null ? `prefetch ${rpc.prefetch}` : null, rpc.sharedBy > 1 ? `shared by ${rpc.sharedBy} commands` : null].filter(Boolean).join(', '))) : null,
    kv('Replies to', 'the caller\'s ', h('span.key', 'replyTo'), ' queue, matched by correlation id'),
    rpc.library ? kv('Library', h('span.key', rpc.library)) : null);
  return [card('Callers', rpc.callers.length, callers), card(`Served by ${service}`, null, plumbing)];
}
