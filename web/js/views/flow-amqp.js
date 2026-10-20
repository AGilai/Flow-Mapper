// Pure helpers for RabbitMQ in the flow diagram (0.18.0), no DOM:
//  - RPC over AMQP is a sync call in olive: the command is the arrow's label, "amqp rpc" is a chip on the first call per caller and server pair,
//    a small glyph on later ones, and only the first reply per pair is labelled (a timeout always is);
//  - a publish through an exchange: the branch marker per exchange type, the muted line for the bindings that do not match, the empty-handed pill.

const SYNC = new Set(['http', 'rpc', 'grpc']);

/** A trace message of an RPC over AMQP (`rpc` on the call, or an entry through an `amqp-rpc:` ingress). */
export const isRpc = (m) => !!m?.rpc || (m?.transport === 'amqp' && /^amqp-rpc:/.test(String(m.label ?? '')));
/** Whether a call opens a sync bar with a return arrow: http, rpc and grpc calls and RPCs over AMQP. */
export const isSyncCall = (m) => m.mode === 'sync' && (SYNC.has(m.transport) || isRpc(m));
/** The transport that colours a message: an RPC is olive (rpc), the wire (amqp) only shows in the chip. */
export const tOf = (m) => (isRpc(m) ? 'rpc' : m.transport);
/** The command an RPC call names: the label of its arrow. */
export const rpcCommand = (m) => m.rpc?.command ?? String(m.label ?? '').match(/amqp-rpc:(\S+)/)?.[1] ?? m.label;

/** 5000 -> "5 s", 1500 -> "1.5 s", 250 -> "250 ms". */
export const timeoutText = (ms) => (ms >= 1000 ? `${Math.round(ms / 100) / 10} s` : `${ms} ms`);

/**
 * pairPlan() -> (callerId, serverId, rpc) -> { first, chip, glyph, reply }
 * One call per caller and server pair gets the "amqp rpc" chip (the first), the others the glyph. `reply` is the text on the dashed reply:
 * "reply" on the pair's first, nothing on the later ones, "reply or timeout 5 s" whenever the call has a timeout.
 */
export function pairPlan() {
  const seen = new Set();
  return (caller, server, rpc) => {
    const key = `${caller}>${server}`, first = !seen.has(key);
    seen.add(key);
    const t = rpc?.timeoutMs ? `reply or timeout ${timeoutText(rpc.timeoutMs)}` : first ? 'reply' : '';
    return { first, chip: first, glyph: !first, reply: t };
  };
}

/** The exchange a message is routed through, from its `amqp` info; null for anything else. */
export const exchangeName = (m) => m?.amqp?.exchange ?? null;

/** "x=1, y=2" of a binding's headers, with its x-match: "all: type=logout, tier=edge". */
const headersText = (f) => `${f.xMatch === 'any' ? 'any' : 'all'}: ${Object.entries(f.headers).filter(([k]) => !k.startsWith('x-')).map(([k, v]) => `${k}=${v}`).join(', ')}`;

/**
 * The branch marker of an exchange -> queue hop by the exchange's type: topic (or undeclared) shows the binding key, a headers exchange the header match
 * (dashed "possible" when the publisher's headers are unknown), direct and fanout none (it would only repeat the trunk, or there is no key).
 * Returns { kind: 'key', label, full } or null.
 */
export function exchangeMarker(filter, amqp) {
  if (!filter) return null;
  const who = `${filter.id} (${filter.service})`, type = amqp?.type;
  if (type === 'direct' || type === 'fanout') return null;
  if (type === 'headers') {
    if (!filter.headers) return null;
    const maybe = amqp.possible?.includes(filter.id), label = (maybe ? 'possible · ' : '') + headersText(filter);
    return { kind: 'key', label, full: `Binding ${who}: headers ${headersText(filter)}${maybe ? '. The publisher\'s headers are not known, so it may not match.' : ''}` };
  }
  const key = filter.bindingKey ?? String(filter.from).replace(/^amqp:[^/]*\/?/, '');
  return key ? { kind: 'key', label: key, full: `Binding ${who}: binding key ${key}${filter.match === 'amqp-topic' ? ' (topic: * one word, # zero or more)' : ''}` } : null;
}

/** The routing key on the trunk next to the event type. Not for a fanout exchange: RabbitMQ ignores the key there. */
export const trunkKey = (m) => (m?.amqp?.type === 'fanout' ? null : m?.amqp?.routingKey ?? null);

/** "2 bindings don't match: audit.#, system.#" (more than three keys: the first three and "+N"); null when all match or there are none. */
export function nonMatchText(amqp) {
  const n = amqp?.nonMatching?.length ?? 0;
  if (!n || !amqp.matched) return null; // nothing routed: the pill says so, the exchange page lists the bindings
  const keys = [...new Set(amqp.nonMatching.map((b) => b.key))];
  const shown = keys.slice(0, 3).join(', ') + (keys.length > 3 ? ` +${keys.length - 3}` : '');
  return `${n === 1 ? "1 binding doesn't" : `${n} bindings don't`} match: ${shown}`;
}

/** Why the arrow ends at the exchange: nothing routes it. */
export const noMatchText = (amqp) => (amqp?.alternateExchange ? `no binding matches: goes to ${amqp.alternateExchange}` : 'no binding matches: dropped');
