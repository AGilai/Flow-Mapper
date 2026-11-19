// #137: an egress with transport `rpc` may say how the call travels: `details.carrier` (`http`) and `details.via` (the library, `saferxlib`).
// This is the pure text for the Info panels and the carrier fields the trace, get_call and the endpoint info carry. No `node:` imports.

import type { GraphIndex } from './graph-index.ts';
import { sid } from './graph-index.ts';
import { refKey } from './resolve.ts';
import type { Details, Ingress } from './types.ts';

/** What an rpc egress declares about its carrier: both optional, plain strings. */
export interface Carrier { carrier?: string; via?: string }
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : undefined);

/** The carrier of an egress with transport `rpc`; empty for any other transport (nothing else reads `details.carrier`). */
export function carrierOf(e: { transport: string; details?: Details }): Carrier {
  if (e.transport !== 'rpc') return {};
  const carrier = text(e.details?.carrier), via = text(e.details?.via);
  return { ...(carrier ? { carrier } : {}), ...(via ? { via } : {}) };
}

/** `POST /internal/rpc` when the ingress is an http endpoint on exactly that path, else undefined. */
export function rpcEndpointOf(i: { transport: string; bindKey: string; details?: Details } | undefined): string | undefined {
  if (!i || i.transport !== 'http') return undefined;
  const key = /^http:([A-Za-z]+)\s+[^/\s]*(\/\S*)$/.exec(i.bindKey);
  const path = text(i.details?.path) ?? key?.[2], method = (text(i.details?.method) ?? key?.[1])?.toUpperCase();
  return path === '/internal/rpc' && method ? `${method} ${path}` : undefined;
}

/** "RPC over HTTP (POST /internal/rpc on users-svc, via saferxlib)"; "RPC over HTTP" with nothing more to say; "RPC (carrier unknown)" without a carrier. */
export function rpcTransportText(c: Carrier & { at?: string; service?: string }): string {
  if (!c.carrier) return 'RPC (carrier unknown)';
  const where = c.at ? `${c.at}${c.service ? ` on ${c.service}` : ''}` : '';
  const more = [where, c.via ? `via ${c.via}` : ''].filter(Boolean).join(', ');
  return `RPC over ${c.carrier.toUpperCase()}${more ? ` (${more})` : ''}`;
}

/** The receiving side: "Called as RPC over HTTP by 2 callers"; mixed carriers "Called as RPC by 3 callers (HTTP: 2, carrier unknown: 1)". Callers are distinct services; null when nobody calls it as rpc. */
export function rpcReceivedText(callers: (Carrier & { service: string })[]): string | null {
  const by = new Map<string, string | undefined>();
  for (const c of callers) if (!by.get(c.service)) by.set(c.service, c.carrier?.toUpperCase());
  if (!by.size) return null;
  const n = `${by.size} caller${by.size === 1 ? '' : 's'}`, groups = new Map<string, number>();
  for (const k of by.values()) groups.set(k ?? 'carrier unknown', (groups.get(k ?? 'carrier unknown') ?? 0) + 1);
  if (groups.size === 1) { const [k] = groups.keys(); return k === 'carrier unknown' ? `Called as RPC by ${n} (carrier unknown)` : `Called as RPC over ${k} by ${n}`; }
  return `Called as RPC by ${n} (${[...groups].map(([k, v]) => `${k}: ${v}`).join(', ')})`;
}

/** The rpc calls into an ingress (egress with transport `rpc` that resolve to it) with their carriers, and the sentence for the panel. Null when there are none. */
export function rpcCalledOf(g: GraphIndex, ing: Ingress): { text: string; callers: (Carrier & { service: string; egress: string })[] } | null {
  const callers: (Carrier & { service: string; egress: string })[] = [];
  for (const l of g.into.get(refKey({ type: 'ingress', service: ing.service, id: ing.id })) ?? []) {
    const e = l.from.type === 'egress' ? g.egress.get(sid(l.from.service, l.from.id)) : undefined;
    if (e?.transport === 'rpc' && !callers.some((c) => c.service === e.service && c.egress === e.id)) callers.push({ service: e.service, egress: e.id, ...carrierOf(e) });
  }
  const text = rpcReceivedText(callers);
  return text ? { text, callers } : null;
}
