// References in flows (design environments only). A trace is decorated after the fact, so core/trace.ts stays as it is:
//   decorateDesignTrace   messages that reach a reference endpoint gain `reference`, service participants gain `serviceKind`,
//                         and `partial.steps` lists the first message into each reference (absent when the flow has none)
//   refsReached           per entry point, how many distinct reference endpoints its flow reaches (graph reachability, no tracing)
// Message numbers here are 0-based indexes into `trace.messages`; the UI maps them to its own step numbers.

import type { GraphIndex } from './graph-index.ts';
import { sid } from './graph-index.ts';
import { componentSets } from './flow-counts.ts';
import type { EnvRefs } from './references.ts';
import { entryPoints, type Message, type Participant, type Trace } from './trace.ts';

export interface PartialStep { message: number; anchor: string; service: string; ingress: string; label: string; source: string }
export type DesignMessage = Message & { reference?: { anchor: string; source: string } };
export type DesignParticipant = Participant & { serviceKind?: string };
export type DesignTrace = Omit<Trace, 'messages' | 'participants'> & { messages: DesignMessage[]; participants: DesignParticipant[]; partial?: { steps: PartialStep[] } };

const CROSSING = new Set(['entry', 'egress', 'deliver']);

export function decorateDesignTrace(t: Trace, refs: EnvRefs, kindOf: (service: string) => string | undefined): DesignTrace {
  const steps: PartialStep[] = [], seen = new Set<string>();
  const messages = t.messages.map((m, message): DesignMessage => {
    const anchor = m.target && CROSSING.has(m.kind) ? `ing:${m.target.service}/${m.target.ingress}` : null;
    const ref = anchor ? refs.endpoints[anchor] : undefined;
    if (!anchor || !ref) return m;
    if (!seen.has(anchor)) { seen.add(anchor); steps.push({ message, anchor, service: ref.service, ingress: ref.ingress, label: ref.bindKey, source: ref.source }); }
    return { ...m, reference: { anchor, source: ref.source } };
  });
  const participants = t.participants.map((p): DesignParticipant => {
    const kind = p.kind === 'service' && p.service ? kindOf(p.service) : undefined;
    return kind ? { ...p, serviceKind: kind } : p;
  });
  return { ...t, messages, participants, ...(steps.length ? { partial: { steps } } : {}) };
}

const reached = new WeakMap<GraphIndex, WeakMap<EnvRefs, Map<string, number>>>();

/** `${service}:${ingress}` of an entry point -> number of distinct reference endpoints its flow reaches (entries that reach none are absent). */
export function refsReached(g: GraphIndex, refs: EnvRefs): Map<string, number> {
  let per = reached.get(g);
  if (!per) reached.set(g, (per = new WeakMap()));
  const hit = per.get(refs);
  if (hit) return hit;
  const out = new Map<string, number>();
  per.set(refs, out);
  if (!Object.keys(refs.endpoints).length) return out;
  const sets = componentSets(g, (i) => (refs.endpoints[`ing:${i.service}/${i.id}`] ? `i:${i.service}/${i.id}` : undefined));
  for (const e of entryPoints(g)) {
    const ids = new Set<string>();
    for (const fn of [e.handler, ...(e.middleware ?? [])]) for (const c of sets.get(sid(e.service, fn)) ?? []) if (c.startsWith('i:')) ids.add(c);
    if (ids.size) out.set(sid(e.service, e.id), ids.size);
  }
  return out;
}
