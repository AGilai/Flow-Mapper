// What an annotation write (comment, action item, notes) needs to know about a flow, without tracing it every time (perf batch 3, F9).
// Existence is a lookup. The trace is only built when a step or a step range has to be checked, and is kept per graph (a new graph after
// any change to the environment, so nothing goes stale): once per flow per graph.

import { sid, type GraphIndex } from '../../core/graph-index.ts';
import { trace, type Trace } from '../../core/trace.ts';
import { HASH_TRACE, stepBase, stepKey } from '../../core/description.ts';
import { notFound } from '../errors.ts';

export interface FlowSteps { t: Trace; bases: Set<string> }
const memo = new WeakMap<GraphIndex, Map<string, FlowSteps>>();
const CAP = 16;

/** Same answer as `trace(g, {service, ingress}, HASH_TRACE) !== null` (an ingress without a handler is an empty flow, not a 404). */
export function flowExists(g: GraphIndex, service: string, ingress: string): boolean {
  if (!g.model.services.length) return false;
  const ing = g.ingress.get(sid(service, ingress));
  if (!ing) return false;
  return !ing.handler || g.fns.has(sid(service, ing.handler));
}

export function requireFlow(g: GraphIndex, env: string, service: string, ingress: string): void {
  if (!flowExists(g, service, ingress)) throw notFound(`ingress '${ingress}' of service '${service}' in env '${env}'`);
}

/** The flow's trace and its step bases, built once per graph (404 when the flow does not exist). */
export function flowSteps(g: GraphIndex, env: string, service: string, ingress: string): FlowSteps {
  requireFlow(g, env, service, ingress);
  let m = memo.get(g);
  if (!m) memo.set(g, (m = new Map()));
  const key = sid(service, ingress), hit = m.get(key);
  if (hit) return hit;
  const t = trace(g, { service, ingress }, HASH_TRACE);
  if (!t) throw notFound(`ingress '${ingress}' of service '${service}' in env '${env}'`);
  const made = { t, bases: new Set(t.messages.map(stepKey)) };
  if (m.size >= CAP) m.delete(m.keys().next().value!);
  m.set(key, made);
  return made;
}

/** `hasStep` against the memoised bases. */
export const hasStepIn = (s: FlowSteps, callee: string) => s.bases.has(stepBase(callee));
