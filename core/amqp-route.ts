// Which bindings of an exchange a publish reaches, by the exchange's type (core/amqp.ts has the rules), and the additive trace
// info built from it. Also the RPC details of a call over AMQP.

import type { Binding, Details } from './types.ts';
import { keyMatches } from './glob.ts';
import { bindingKeyOf, exchangeType, headersMatch, splitAmqpKey, type ExchangeType } from './amqp.ts';

export interface Routing {
  exchange: string; routingKey?: string; type?: ExchangeType;
  /** Bindings that route the message (on a headers exchange: those that do for sure). */
  matched: Binding[];
  /** Headers exchange, publisher's headers unknown: bindings that route it only if the headers happen to satisfy them. */
  possible: Binding[];
  /** Bindings of the same exchange that do not route it. */
  nonMatching: Binding[];
}

/**
 * routeKey(bindings, exchangeDetails, key, published): null when `key` is not an AMQP publish key (`amqp:<exchange>[/<routing key>]`).
 * topic / direct / undeclared: the binding key matches the routing key (a binding says how: exact, glob, amqp-topic); fanout: every binding;
 * headers: the headers of the publish (`details.headers`) against the binding's (`details.headers`, `details.xMatch`).
 */
export function routeKey(bindings: Binding[], exchangeDetails: Details | undefined, key: string, published?: Details): Routing | null {
  const k = splitAmqpKey(key);
  if (!k) return null;
  const type = exchangeType(exchangeDetails);
  const mine = bindings.filter((b) => splitAmqpKey(b.from)?.exchange === k.exchange);
  const matched: Binding[] = [], possible: Binding[] = [], nonMatching: Binding[] = [];
  for (const b of mine) {
    if (type === 'fanout') matched.push(b);
    else if (type === 'headers') { const r = headersMatch(b.details, published); (r === 'unknown' ? possible : r ? matched : nonMatching).push(b); }
    else (keyMatches(b.from, b.match, key) ? matched : nonMatching).push(b);
  }
  return { exchange: k.exchange, ...(k.routingKey != null ? { routingKey: k.routingKey } : {}), ...(type ? { type } : {}), matched, possible, nonMatching };
}

/** What a trace says about one publish to an exchange (additive `amqp` on its messages). */
export interface AmqpRoute {
  exchange: string; routingKey?: string; type?: ExchangeType; alternateExchange?: string;
  /** Bindings of the exchange that route this publish (possible ones included). */
  matched: number;
  /** The bindings of the exchange that do not route it, for the muted "N bindings don't match" line. */
  nonMatching: { id: string; service: string; key: string; queue: string }[];
  /** Headers exchange with unknown publisher headers: the bindings that route it only possibly. */
  possible?: string[];
}

export function routeInfo(r: Routing, exchangeDetails: Details | undefined): AmqpRoute {
  const alt = exchangeDetails?.alternateExchange;
  return {
    exchange: r.exchange, ...(r.routingKey != null ? { routingKey: r.routingKey } : {}), ...(r.type ? { type: r.type } : {}),
    ...(typeof alt === 'string' && alt ? { alternateExchange: alt } : {}),
    matched: r.matched.length + r.possible.length,
    nonMatching: r.nonMatching.map((b) => ({ id: b.id, service: b.service, key: bindingKeyOf(b), queue: b.to })),
    ...(r.possible.length ? { possible: r.possible.map((b) => b.id) } : {}),
  };
}

/** RPC over AMQP as the caller and the server declare it (`details.rpc` on the egress and on the ingress; `prefetch` is the server's). */
export interface RpcInfo {
  command: string; commandQueue?: string; replyTo?: string; exchange?: string; correlation?: string; timeoutMs?: number; library?: string; prefetch?: number;
  /** Which side declared it: the caller only (no server harvested), or both. */
  declaredBy: 'caller' | 'both';
}
const RPC_FIELDS = ['commandQueue', 'replyTo', 'exchange', 'correlation', 'timeoutMs', 'library', 'prefetch'] as const;

function pick(into: RpcInfo, d: Details | null, fillOnly = false): RpcInfo {
  const out: Record<string, unknown> = { ...into };
  for (const f of RPC_FIELDS) if (d && d[f] != null && (!fillOnly || out[f] == null)) out[f] = d[f];
  return out as unknown as RpcInfo;
}
const rpcDetails = (d: Details | undefined): Details | null => (d?.rpc && typeof d.rpc === 'object' ? (d.rpc as Details) : null);

/** The RPC an egress makes: `amqp-rpc:{command}` key or `details.rpc`. Null for anything else. */
export function rpcOf(e: { bindKey: string; transport: string; details?: Details }): RpcInfo | null {
  const d = rpcDetails(e.details);
  if (e.transport !== 'amqp' || !(e.bindKey.startsWith('amqp-rpc:') || d)) return null;
  const command = typeof d?.command === 'string' ? d.command : e.bindKey.replace(/^amqp-rpc:/, '');
  return pick({ command, declaredBy: 'caller' }, d);
}

/** The caller's RPC details completed by the server's (the caller's own values win; `prefetch` comes from the server). */
export const withServer = (rpc: RpcInfo, server: Details | undefined): RpcInfo => pick({ ...rpc, declaredBy: 'both' }, rpcDetails(server), true);
