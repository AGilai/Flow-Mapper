// The RabbitMQ parts of the message panel (0.18.0): the AMQP details of an RPC call, and how an exchange routed a publish.

import { h } from '../dom.js';
import { section } from '../components/panel.js';
import { timeoutText, noMatchText } from './flow-amqp.js';

const row = (k, v, sub) => (v == null || v === '' ? [] : [h('dt', k), h('dd', h('span.key', String(v)), sub ? h('span.xs.muted', ` ${sub}`) : null)]);

/** The "AMQP" card of an RPC call: exchange, command queue, reply queue, correlation, timeout, library, prefetch. */
export function rpcCard(m) {
  const r = m.rpc;
  if (!r) return null;
  return section('AMQP', null, h('dl.kv',
    ...row('Command', r.command),
    ...row('Exchange', r.exchange === '' ? '(default)' : r.exchange, r.exchange === '' ? 'direct' : ''),
    ...row('Command queue', r.commandQueue),
    ...row('Reply queue', r.replyTo),
    ...row('Correlation', r.correlation),
    ...row('Timeout', r.timeoutMs ? timeoutText(r.timeoutMs) : null, r.timeoutMs ? 'the reply is "reply or timeout"' : ''),
    ...row('Library', r.library),
    ...row('Prefetch', r.prefetch, 'the server handles this many at once'),
    ...row('Declared by', r.declaredBy === 'both' ? 'caller and server (they agree on the command)' : 'the caller only')));
}

/** Why an RPC has no server: which harvester to look for. */
export function rpcMissing(m) {
  const q = m.rpc?.commandQueue;
  return section('Why it is broken', null, h('p.small', `No service was harvested that serves ${m.rpc?.command ?? 'this command'}. Look for the harvester of the service that consumes ${q ? `the queue ${q}` : 'the command queue'} and handles this command (an ingress with bind key amqp-rpc:${m.rpc?.command ?? '{command}'}).`));
}

/** How the exchange routed a publish: routing key, exchange type, how many bindings match, and the ones that do not. */
export function routingRows(m) {
  const a = m.amqp;
  if (!a) return [];
  const total = a.matched + a.nonMatching.length;
  return [...row('Routing key', a.routingKey, a.type === 'fanout' ? 'ignored: this is a fanout exchange' : ''), ...row('Exchange type', a.type),
    h('dt', 'Bindings'), h('dd', a.matched ? `${a.matched} of ${total} match` : noMatchText(a), ...(a.nonMatching.length ? [h('div.xs.muted', `Do not match: ${a.nonMatching.map((b) => `${b.key} (${b.service})`).join(', ')}`)] : []))];
}
