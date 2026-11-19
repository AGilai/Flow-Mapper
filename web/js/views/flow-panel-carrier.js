// #137: how an RPC (transport rpc, not RabbitMQ) travels. The step Info says "Transport: RPC over HTTP (POST /internal/rpc on <service>, via <lib>)";
// the receiving endpoint says "Called as RPC over HTTP by N callers". The texts are core/rpc-carrier.ts.

import { h } from '../dom.js';
import { chip } from '../format.js';
import { rpcTransportText } from '../../core/rpc-carrier.js';

/** An rpc call over a carrier that is not AMQP (messages with `rpc` are RPC over AMQP and have their own card). */
export const isCarrierRpc = (m) => m.transport === 'rpc' && !m.rpc;

/** The small carrier chip next to the `rpc` chip ("http"); null without a carrier. */
export const carrierChip = (m) => (isCarrierRpc(m) && m.carrier ? chip(m.carrier, m.carrier) : null);

/** The "Transport: ..." line of an rpc step; null for any other message. */
export function carrierNote(m) {
  if (!isCarrierRpc(m)) return null;
  const text = rpcTransportText({ carrier: m.carrier, via: m.carrierVia, at: m.carrierAt, service: m.target?.service });
  return h('p.small.ep-pad.carrier-note', h('strong', 'Transport: '), text);
}

/** The receiving side of the endpoint panel: "Called as RPC over HTTP by N callers"; null when nobody calls it as rpc. */
export const rpcCalledNote = (info) => (info.rpcCalled ? h('p.small.ep-pad.carrier-note', info.rpcCalled.text) : null);
