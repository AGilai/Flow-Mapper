// RabbitMQ rules, pure. A publish key is `amqp:<exchange>/<routing key>`, a binding's `from` the same with the binding key.
//   topic exchange : `*` is exactly one word, `#` zero or more words, words are separated by dots (match: 'amqp-topic')
//   direct         : the binding key equals the routing key (match: 'exact')
//   fanout         : every binding of the exchange receives the message, the routing key is ignored
//   headers        : `x-match` all|any over the binding's headers; the routing key is ignored
// A placeholder word such as `{deviceId}` in a published routing key is one word, like any other.

import type { Details } from './types.ts';

export type ExchangeType = 'topic' | 'direct' | 'fanout' | 'headers';

/** "amqp:shipping/shipping.created" -> { exchange: 'shipping', routingKey: 'shipping.created' }; "amqp:shipping" has no routingKey. Null for other keys. */
export function splitAmqpKey(key: string): { exchange: string; routingKey?: string } | null {
  if (!key.startsWith('amqp:')) return null;
  const rest = key.slice(5), at = rest.indexOf('/');
  return at < 0 ? { exchange: rest } : { exchange: rest.slice(0, at), routingKey: rest.slice(at + 1) };
}

/** RabbitMQ topic match of a binding pattern against a routing key: `*` one word, `#` zero or more words (`audit.#` matches `audit`). */
export function topicMatch(pattern: string, key: string): boolean {
  const p = pattern.split('.'), k = key.split('.');
  const go = (i: number, j: number): boolean => {
    if (i === p.length) return j === k.length;
    if (p[i] === '#') { for (let n = j; n <= k.length; n++) if (go(i + 1, n)) return true; return false; }
    if (j === k.length) return false;
    return (p[i] === '*' || p[i] === k[j]) && go(i + 1, j + 1);
  };
  return go(0, 0);
}

/** A binding key (`from`) against a published key (match 'amqp-topic'): the exchange is equal and the routing keys match as topics. */
export function amqpTopicMatches(pattern: string, key: string): boolean {
  const a = splitAmqpKey(pattern), b = splitAmqpKey(key);
  return !!a && !!b && a.exchange === b.exchange && topicMatch(a.routingKey ?? '', b.routingKey ?? '');
}

const headerMap = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : null);

/**
 * A headers exchange: do the publisher's headers satisfy the binding? `xMatch` all (default) or any; keys starting with `x-` are not compared.
 * 'unknown' when the publisher's headers are not known (it routes only if they happen to satisfy the binding).
 */
export function headersMatch(binding: Details | undefined, published: Details | undefined): boolean | 'unknown' {
  const want = headerMap(binding?.headers);
  if (!want) return true;
  const have = headerMap(published?.headers);
  if (!have) return 'unknown';
  const keys = Object.keys(want).filter((k) => !k.startsWith('x-'));
  const hit = (k: string) => k in have && (want[k] === null || String(have[k]) === String(want[k]));
  return !keys.length || (binding?.xMatch === 'any' ? keys.some(hit) : keys.every(hit));
}

/** The exchange type a channel declares (`details.type`); undefined when it says nothing. */
export const exchangeType = (details: Details | undefined): ExchangeType | undefined =>
  (['topic', 'direct', 'fanout', 'headers'] as const).find((t) => t === details?.type);

/** The words of a binding key as the marker shows them: `details.bindingKey` as written in code, else the routing-key part of `from`. */
export const bindingKeyOf = (b: { from: string; details?: Details }): string =>
  typeof b.details?.bindingKey === 'string' ? b.details.bindingKey : splitAmqpKey(b.from)?.routingKey ?? '';
