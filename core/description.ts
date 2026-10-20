// Flow descriptions, the pure part. Two records per key (source human | ai); key = service + ingress (the whole
// flow, callee '') or + callee (a service, or "service:handler" for one delivery). The AI record keeps the hash of the
// trace it was written from, so a changed trace marks it outdated. Shared with the browser (preview, prompts).

import type { Trace, Message } from './trace.ts';

export interface HumanRecord { text: string; editedBy: string; editedAt: string }
export interface AiRecord { text: string; model: string; generatedAt: string; traceHash: string; outdated: boolean }
export interface DescPair { human: HumanRecord | null; ai: AiRecord | null }
/** A stored row as the server keeps it (callee '' = the whole flow). */
export interface DescRow { callee: string; source: 'human' | 'ai'; text: string; author: string | null; model: string | null; traceHash: string | null; updatedAt: string }
export interface FlowDescriptions { service: string; ingress: string; hash: string; flow: DescPair; callees: Record<string, DescPair> }

/** Trace options both the server and the preview use for the hash, so they agree. */
export const HASH_TRACE = { scope: 'full' as const, maxMessages: 2000 };

/** cyrb53: a small, stable 53-bit string hash (no node:crypto, so it also runs in the browser). */
export function hash53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
}

const sig = (m: Message) => [m.depth, m.kind, m.from, m.to, m.label, m.transport ?? '', m.event ?? '', m.target?.service ?? '', m.target?.ingress ?? '', m.target?.fn ?? '', m.store ?? '', m.calls ?? '', m.broken ? 1 : 0].join('|');

export const calleeService = (callee: string) => callee.split(':')[0];

/** Hash of what a description describes: the whole trace, or (with a callee) the messages that touch that service. Changes when the flow changes, not between loads. */
export function traceHash(trace: Pick<Trace, 'messages'>, callee = ''): string {
  const svc = calleeService(callee);
  const ms = svc ? trace.messages.filter((m) => m.from === `svc:${svc}` || m.to === `svc:${svc}` || m.target?.service === svc) : trace.messages;
  return hash53(ms.map(sig).join('\n'));
}

export const isOutdated = (ai: { traceHash: string | null } | null, current: string) => !!ai && ai.traceHash !== current;

/** Group stored rows into the shape the UI and MCP read, flagging AI records whose trace has changed. */
export function flowDescriptions(trace: Pick<Trace, 'messages'>, service: string, ingress: string, rows: DescRow[]): FlowDescriptions {
  const pair = (callee: string): DescPair => {
    const h = rows.find((r) => r.callee === callee && r.source === 'human'), a = rows.find((r) => r.callee === callee && r.source === 'ai');
    const cur = traceHash(trace, callee);
    return {
      human: h ? { text: h.text, editedBy: h.author ?? '', editedAt: h.updatedAt } : null,
      ai: a ? { text: a.text, model: a.model ?? '', generatedAt: a.updatedAt, traceHash: a.traceHash ?? '', outdated: isOutdated({ traceHash: a.traceHash }, cur) } : null,
    };
  };
  const callees: Record<string, DescPair> = {};
  for (const c of new Set(rows.map((r) => r.callee).filter(Boolean))) callees[c] = pair(c);
  return { service, ingress, hash: traceHash(trace), flow: pair(''), callees };
}

/** The text a one-line spot shows: the human note if there is one, else the AI text. */
export function lineText(p: DescPair | null | undefined): { text: string; who: 'human' | 'ai'; outdated?: boolean } | null {
  return p?.human?.text ? { text: p.human.text, who: 'human' } : p?.ai?.text ? { text: p.ai.text, who: 'ai', outdated: p.ai.outdated } : null;
}

export interface PromptTarget { env: string; service: string; ingress: string }
const q = (s: string) => JSON.stringify(s);

/** Prompt one: the whole flow, every service in it. For any AI harness that has the Flow-Mapper MCP server connected. */
export function flowPrompt({ env, service, ingress }: PromptTarget): string {
  return `You are documenting a flow in Flow-Mapper. Use the Flow-Mapper MCP server.

Target: env ${q(env)}, service ${q(service)}, ingress ${q(ingress)} (the whole flow, with all its services).

1. Call trace_flow(env=${q(env)}, service=${q(service)}, ingress=${q(ingress)}, scope="full")
   and read every step, activation bar and async consumer in it.
2. For each service that appears, call get_service(env=${q(env)}, service=<name>)
   for its description, owner and functions.
3. Write (a) the flow description: the motivation and purpose of the whole flow, 2 to 4
   plain sentences, then one sentence starting "Why it exists:"; and (b) for each service
   in the flow: what that service does in this flow and why, 1 to 2 sentences.
   Use only facts found in the trace and the service records. Do not invent anything.
4. Save each text with set_description:
   - the flow: set_description(env=${q(env)}, service=${q(service)}, ingress=${q(ingress)}, text=<your text>, model=<your model name>)
   - each service: the same call plus callee=<service name>, for example callee="orders-svc".
5. Reply with one line per description you saved.`;
}

/** Prompt two: one service's part of the flow only. */
export function servicePrompt({ env, service, ingress, callee }: PromptTarget & { callee: string }): string {
  const svc = calleeService(callee);
  return `You are documenting one service's part of a flow in Flow-Mapper. Use the Flow-Mapper MCP server.

Target: env ${q(env)}, the flow ${q(service)} / ${q(ingress)}, the service ${q(svc)} only.

1. Call trace_flow(env=${q(env)}, service=${q(service)}, ingress=${q(ingress)}, scope="full")
   and find what ${svc} does in this flow: who calls it, what it calls, the stores it touches, the events it publishes.
2. Call get_service(env=${q(env)}, service=${q(svc)}) for its description, owner and functions.
3. Write what ${svc} does in this flow and why, 1 to 2 plain sentences.
   Use only facts found in the trace and the service record. Do not invent anything.
4. Save it with set_description(env=${q(env)}, service=${q(service)}, ingress=${q(ingress)},
   callee=${q(callee)}, text=<your text>, model=<your model name>).
5. Reply with the one line you saved.`;
}
