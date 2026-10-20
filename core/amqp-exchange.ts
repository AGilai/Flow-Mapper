// The page of one RabbitMQ exchange (0.19.0), same pattern as a Redis instance (core/instances.ts): what is known about the
// exchange itself, who publishes which routing keys, which bindings route them to which queues and consumers, and the
// problems: a published key that matches no binding (dropped, or sent to the alternate exchange) and a binding that no
// harvested publisher feeds. Routing rules are core/amqp-route.ts's, the same ones the flow diagram draws. Pure.

import type { GraphIndex } from './graph-index.ts';
import { bindingKeyOf, exchangeType, splitAmqpKey, type ExchangeType } from './amqp.ts';
import { routeKey, rpcOf } from './amqp-route.ts';
import { codeLink, type SourceLink } from './endpoint-info.ts';
import { keyMatches } from './glob.ts';
import type { Binding, Egress, Match } from './types.ts';

export interface PublisherRow {
  id: string; service: string; routingKey: string;
  /** Bindings that route it (possible ones on a headers exchange included, flagged). */
  reaches: { id: string; key: string; queue: string; possible?: boolean }[];
  dropped: boolean; alternateExchange?: string;
  /** Functions whose steps publish it, with where it is published. */
  publishedIn: { fn: string; name: string }[]; at: SourceLink | null;
}
export interface BindingRow {
  id: string; service: string; key: string; from: string; match?: Match; queue: string; queueKey: string;
  consumers: { service: string; ingress: string; handler: string }[];
  matchedBy: { service: string; routingKey: string }[];
  /** No harvested service publishes a key this binding routes. */
  noPublisher: boolean; at: SourceLink | null;
}
export interface ExchangeCallout { kind: 'dropped' | 'no-publisher'; text: string; row: { type: 'publisher' | 'binding'; id: string } }
export interface ExchangeSummary { key: string; name: string; kind: 'amqp-exchange'; type?: ExchangeType; team?: string; services: string[]; publisherServices: number; bindingCount: number; problems: number }
export interface ExchangeView extends ExchangeSummary {
  details: Record<string, unknown>; vhost?: string; durable?: boolean; alternateExchange?: string;
  definition: { service: string; source: SourceLink | null; verified: string | null } | null;
  declaredBy: string[];
  publishers: PublisherRow[]; bindings: BindingRow[]; queues: number; consumerServices: string[];
  routingKeys: number; callouts: ExchangeCallout[];
}

/** Exchange names of the env: declared by a channel, or only seen in a binding or a publish key. */
function names(g: GraphIndex): Set<string> {
  const out = new Set<string>();
  for (const c of g.model.channels) if (c.kind === 'amqp-exchange') out.add(splitAmqpKey(c.bindKey)?.exchange ?? c.bindKey);
  for (const b of g.model.bindings) { const x = splitAmqpKey(b.from); if (x) out.add(x.exchange); }
  for (const e of g.model.egress) { const x = e.transport === 'amqp' && !rpcOf(e) ? splitAmqpKey(e.bindKey) : null; if (x?.exchange) out.add(x.exchange); }
  return out;
}

/** The exchange name for an id from a URL or a tool: `amqp:saferx.EventExchange` or the bare name. Null when there is no such exchange. */
export function resolveExchange(g: GraphIndex, id: string): string | null {
  const n = id.startsWith('amqp:') ? id.slice(5) : id;
  return names(g).has(n) ? n : null;
}
export const isExchangeId = (id: string) => id.startsWith('amqp:') && !id.startsWith('amqp:/');

const publishesTo = (e: Egress, name: string) => e.transport === 'amqp' && !rpcOf(e) && splitAmqpKey(e.bindKey)?.exchange === name;
const str = (x: unknown) => (typeof x === 'string' && x ? x : undefined);

export function exchangeView(g: GraphIndex, id: string): ExchangeView | null {
  const name = resolveExchange(g, id);
  if (name == null) return null;
  const key = `amqp:${name}`;
  const decls = g.model.channels.filter((c) => c.bindKey === key);
  const def = decls.find((c) => g.services.get(c.service)?.kind === 'infra') ?? decls[0];
  const d = (def?.details ?? {}) as Record<string, unknown>;
  const type = exchangeType(def?.details);
  const alt = str(d.alternateExchange);
  const mine = g.model.bindings.filter((b) => splitAmqpKey(b.from)?.exchange === name);
  const pubs = g.model.egress.filter((e) => publishesTo(e, name));

  const fed = new Map<string, { service: string; routingKey: string }[]>(); // binding "service/id" -> publishers that route to it
  const publishers: PublisherRow[] = pubs.map((e) => {
    const r = routeKey(g.model.bindings, def?.details, e.bindKey, e.details)!;
    const reach = [...r.matched.map((b) => ({ b, possible: false })), ...r.possible.map((b) => ({ b, possible: true }))];
    const routingKey = r.routingKey ?? '';
    for (const { b } of reach) (fed.get(`${b.service}/${b.id}`) ?? fed.set(`${b.service}/${b.id}`, []).get(`${b.service}/${b.id}`)!).push({ service: e.service, routingKey });
    return {
      id: e.id, service: e.service, routingKey,
      reaches: reach.map(({ b, possible }) => ({ id: b.id, key: bindingKeyOf(b), queue: b.to.replace(/^amqp-queue:/, ''), ...(possible ? { possible } : {}) })),
      dropped: !reach.length, ...(alt ? { alternateExchange: alt } : {}),
      publishedIn: g.model.functions.filter((f) => f.service === e.service && f.steps.some((s) => s.type === 'egress' && s.target === e.id)).map((f) => ({ fn: f.id, name: f.name })),
      at: g.services.has(e.service) ? codeLink(g.services.get(e.service)!, e.source) : null,
    };
  }).sort((a, b) => a.service.localeCompare(b.service) || a.routingKey.localeCompare(b.routingKey));

  const bindings: BindingRow[] = mine.map((b: Binding) => {
    const by = fed.get(`${b.service}/${b.id}`) ?? [];
    return {
      id: b.id, service: b.service, key: bindingKeyOf(b), from: b.from, match: b.match, queue: b.to.replace(/^amqp-queue:/, ''), queueKey: b.to,
      consumers: g.model.ingress.filter((i) => i.bindKey === b.to).map((i) => ({ service: i.service, ingress: i.id, handler: i.handler })),
      matchedBy: by, noPublisher: !by.length, at: g.services.has(b.service) ? codeLink(g.services.get(b.service)!, b.source) : null,
    };
  }).sort((a, b) => a.queue.localeCompare(b.queue) || a.key.localeCompare(b.key));

  const callouts: ExchangeCallout[] = [
    ...publishers.filter((p) => p.dropped).map((p): ExchangeCallout => ({ kind: 'dropped', row: { type: 'publisher', id: `${p.service}/${p.id}` },
      text: `${p.routingKey} from ${p.service} matches no binding, so ${alt ? `RabbitMQ sends it to the alternate exchange ${alt}` : 'RabbitMQ drops it'}.` })),
    ...bindings.filter((b) => b.noPublisher).map((b): ExchangeCallout => ({ kind: 'no-publisher', row: { type: 'binding', id: `${b.service}/${b.id}` },
      text: `${b.key} → ${b.queue}: no harvested service publishes a key it matches. Its publisher's harvester may be missing.` })),
  ];
  const services = [...new Set([...publishers.map((p) => p.service), ...bindings.flatMap((b) => [b.service, ...b.consumers.map((c) => c.service)])])].sort();
  const team = g.services.get(def?.service ?? '')?.team ?? g.services.get(bindings.flatMap((b) => b.consumers)[0]?.service ?? '')?.team;
  return {
    key, name, kind: 'amqp-exchange', type, team, services, publisherServices: new Set(publishers.map((p) => p.service)).size, bindingCount: bindings.length, problems: callouts.length,
    details: d, vhost: str(d.vhost), durable: typeof d.durable === 'boolean' ? d.durable : undefined, alternateExchange: alt,
    definition: def ? { service: def.service, source: g.services.has(def.service) ? codeLink(g.services.get(def.service)!, def.source) : null, verified: def.provenance?.verified ?? null } : null,
    declaredBy: [...new Set(decls.map((c) => c.service))],
    publishers, bindings, queues: new Set(bindings.map((b) => b.queue)).size, consumerServices: [...new Set(bindings.flatMap((b) => b.consumers.map((c) => c.service)))].sort(),
    routingKeys: publishers.length, callouts,
  };
}

/** Every exchange of the env as a list row (the instances list and the inventory). */
export function exchanges(g: GraphIndex): ExchangeSummary[] {
  return [...names(g)].sort().map((n) => {
    const v = exchangeView(g, n)!;
    return { key: v.key, name: v.name, kind: v.kind, type: v.type, team: v.team, services: v.services, publisherServices: v.publisherServices, bindingCount: v.bindingCount, problems: v.problems };
  });
}

/**
 * The routing-key tester of the page, run in the browser on the view: which bindings (by "service/id") a concrete routing key reaches.
 * Fanout reaches all, direct needs equality with the binding key, topic (and undeclared) follow each binding's own match; null for a
 * headers exchange, which routes by message headers and cannot be tested by key.
 */
export function routesTo(v: Pick<ExchangeView, 'name' | 'type' | 'bindings'>, key: string): Set<string> | null {
  if (v.type === 'headers') return null;
  return new Set(v.bindings.filter((b) => v.type === 'fanout' || keyMatches(b.from, v.type === 'direct' ? 'exact' : b.match, `amqp:${v.name}/${key}`)).map((b) => `${b.service}/${b.id}`));
}
