// Pure helpers for "a sub-flow is a full flow that starts at the consumer": who the caller lifeline is, the trace request
// built from a delivery row, and the cache key that lets tabs and cards share one trace. No DOM.

const SYNC = new Set(['http', 'rpc', 'grpc']);
const stripType = (k) => String(k).replace(/^[a-z-]+:/, '');

const socketProtocol = (m) => m.protocol ?? 'tcp';

/**
 * The first lifeline of a flow, from its first message: { id, label, sub, kind }.
 * http / rpc / grpc: "client · browser". A queue (sqs, amqp, sns, eventbridge, event, other): the queue name, with its
 * transport as the sub line. socket: "client · tls socket" (tcp, ws). cron: "schedule". A delivery (a slice that starts at the queue hop): the queue it came from.
 */
export function callerFor(first) {
  if (!first) return { id: 'client', label: 'client', sub: 'browser', kind: 'client' };
  if (first.kind === 'deliver') return { id: 'src', label: first.from.replace(/^ch:/, ''), sub: 'queue delivery', kind: 'source' };
  const t = first.transport;
  if (!t || SYNC.has(t)) return { id: 'client', label: 'client', sub: 'browser', kind: 'client' };
  const key = String(first.label ?? '').split(' · ')[0];
  if (t === 'amqp' && key.startsWith('amqp-rpc:')) return { id: 'client', label: 'caller', sub: 'amqp rpc', kind: 'client' };
  if (t === 'cron') return { id: 'src', label: 'schedule', sub: ['cron', stripType(key)].filter(Boolean).join(' · '), kind: 'source' };
  if (t === 'socket') return { id: 'client', label: 'client', sub: `${socketProtocol(first)} socket`, kind: 'client' };
  const q = stripType(key);
  return { id: 'src', label: q || t, sub: `${t === 'amqp-queue' ? 'amqp' : t} queue`, kind: 'source', ...(t === 'amqp' ? { transport: 'amqp' } : {}) };
}

/** The trace request of the flow a delivery row starts: its consumer's ingress with the delivered event (only that handler runs). */
export function subRequest(row, { frontier = false } = {}) {
  return { service: row.service, ingress: row.ingress, event: row.event ?? null, scope: 'full', maxMessages: 800, frontier: frontier ? '1' : null };
}

/** One key per distinct trace request: service, ingress, event, frontier. */
export const requestKey = (q) => [q.service, q.ingress ?? q.fn ?? '', q.event ?? '', q.scope ?? 'full', q.frontier ? 'f' : ''].join('|');

/** A flow's identity without options: service, ingress, event. A row whose flow is one of its ancestors loops back. */
export const flowId = (q) => `${q.service}|${q.ingress ?? ''}|${q.event ?? ''}`;
