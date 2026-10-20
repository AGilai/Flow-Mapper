// The RPC side of an endpoint panel (0.19.0): who calls an RPC command (each with its function, source link and timeout:
// callers often differ), and what the server declares about the command queue. Pure.

import type { GraphIndex } from './graph-index.ts';
import type { Ingress } from './types.ts';
import { codeLink, type SourceLink } from './endpoint-info.ts';
import { rpcOf, rpcServed, type RpcInfo } from './amqp-route.ts';

export interface RpcCaller { service: string; egress: string; fn?: { id: string; name: string }; timeoutMs?: number; replyTo?: string; source: SourceLink | null }
export interface RpcPanel {
  command: string; commandQueue?: string; prefetch?: number; library?: string;
  /** The command queue serves this many commands of the server (the commands whose ingress names that queue). */
  sharedBy: number;
  callers: RpcCaller[];
}

/** Null when the ingress is not an RPC command. */
export function rpcPanel(g: GraphIndex, i: Ingress): RpcPanel | null {
  const r = rpcServed(i);
  if (!r) return null;
  const callers: RpcCaller[] = [];
  for (const e of g.model.egress) {
    const c: RpcInfo | null = rpcOf(e);
    if (c?.command !== r.command) continue;
    const f = g.model.functions.find((x) => x.service === e.service && x.steps.some((s) => s.type === 'egress' && s.target === e.id));
    callers.push({ service: e.service, egress: e.id, ...(f ? { fn: { id: f.id, name: f.name } } : {}), ...(c.timeoutMs != null ? { timeoutMs: c.timeoutMs } : {}), ...(c.replyTo ? { replyTo: c.replyTo } : {}),
      source: g.services.has(e.service) ? codeLink(g.services.get(e.service)!, e.source) : null });
  }
  const sharedBy = r.commandQueue ? g.model.ingress.filter((x) => x.service === i.service && rpcServed(x)?.commandQueue === r.commandQueue).length : 0;
  return { command: r.command, commandQueue: r.commandQueue, prefetch: r.prefetch, library: r.library, sharedBy, callers: callers.sort((a, b) => a.service.localeCompare(b.service)) };
}
