// Wrapper hops ("via"): a call made through a wrapper is one call; the chain only describes it.
// Harvesters may send `via` / `callSites` as fields or inside free-form `details`; both are read here.
// Pure; used by the server and the static preview. Hops never become producers, nodes or edges.

import type { CallSite, Egress, Ingress, Service, ViaHop } from './types.ts';
import { codeLink, type SourceLink } from './endpoint-info.ts';

export interface LinkedHop extends ViaHop { link: SourceLink | null }
export interface LinkedCallSite { file: string; line?: number; function?: string; link: SourceLink | null; via: LinkedHop[] }
/** What a view shows for an egress: its own chain, and each call site's chain. */
export interface EgressVia { via: LinkedHop[]; callSites: LinkedCallSite[] }

const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** Keeps well-formed hops (an object with a function name or a file); drops anything else. */
export function normaliseVia(raw: unknown): ViaHop[] {
  if (!Array.isArray(raw)) return [];
  const out: ViaHop[] = [];
  for (const h of raw) {
    if (!h || typeof h !== 'object') continue;
    const x = h as Record<string, any>;
    const fn = str(x.function) ?? str(x.symbol) ?? str(x.name);
    if (!fn && !str(x.file)) continue;
    out.push({ function: fn ?? x.file, file: str(x.file), line: num(x.line), col: num(x.col), kind: str(x.kind) ?? 'wrapper', repo: str(x.repo), commit: str(x.commit) });
  }
  return out;
}

export const egressViaHops = (e: Pick<Egress, 'via' | 'details'>): ViaHop[] => normaliseVia(e.via ?? (e.details as any)?.via);

/** Hops that resolved an ingress to its handler (kind 'registration' | 'bind'); same shape as egress `via`. */
export const ingressViaHops = (i: Pick<Ingress, 'via' | 'details'>): ViaHop[] => normaliseVia(i.via ?? (i.details as any)?.handlerVia);
export const ingressVia = (svc: Service, i: Ingress): LinkedHop[] => linkHops(svc, ingressViaHops(i));

export function egressCallSites(e: Pick<Egress, 'callSites' | 'details'>): CallSite[] {
  const raw = e.callSites ?? (e.details as any)?.callSites;
  if (!Array.isArray(raw)) return [];
  return raw.filter((c) => c && typeof c.file === 'string').map((c) => ({ file: c.file, line: num(c.line), function: str(c.function), via: normaliseVia(c.via) }));
}

export const linkHops = (svc: Service, hops: ViaHop[]): LinkedHop[] =>
  hops.map((h) => ({ ...h, link: h.file ? codeLink(svc, { file: h.file, line: h.line, repo: h.repo, commit: h.commit }) : null }));

export function egressVia(svc: Service, e: Egress): EgressVia {
  return {
    via: linkHops(svc, egressViaHops(e)),
    callSites: egressCallSites(e).map((c) => ({ file: c.file, line: c.line, function: c.function, via: linkHops(svc, c.via ?? []), link: codeLink(svc, { file: c.file, line: c.line }) })),
  };
}

/** True when a hop's function or file contains `q` (case-insensitive), on the egress chain or any call site's. */
export function viaMatches(v: EgressVia, q: string): boolean {
  const n = q.toLowerCase();
  const hit = (hops: LinkedHop[]) => hops.some((h) => h.function.toLowerCase().includes(n) || h.file?.toLowerCase().includes(n));
  return hit(v.via) || v.callSites.some((c) => hit(c.via));
}

/** The chip text: the wrapper closest to the SDK call ("SNSManager.publish"), or null when there is no chain. */
export const viaLabel = (hops: { function: string }[] | undefined | null): string | null => (hops?.length ? hops[hops.length - 1].function : null);
