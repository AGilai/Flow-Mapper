// #85, incomplete flows (docs/plans/incomplete-flows.md), pure: which steps of a flow are blocked (an `unresolved[]` entry with `gap: true`), how many,
// and where they are. Only `gap === true` counts; `gap` absent or false never does. Shared by the trace walker, the Flows list and the info pane.

import type { GraphIndex } from './graph-index.ts';
import { sid } from './graph-index.ts';
import { codeLink } from './endpoint-info.ts';
import type { Details, Ingress, Step, Unresolved } from './types.ts';
import type { Message, Trace } from './trace-types.ts';

/** A blocked call: where it is (`id` = `<service>:<fn>#<seq>`), what the code says, why it stopped, and the source line (`url` is the repository link when one is known). */
export interface BlockedSite { id: string; service: string; fn: string; seq: number; call?: string; reason?: string; plain?: string; file?: string; line?: number; url?: string | null }
/** `details.coverage` of an ingress: what the harvester knows about the flow's own service. */
export interface Coverage { status?: 'complete' | 'incomplete'; blocked?: number; sites?: Omit<BlockedSite, 'id' | 'service'>[]; more?: number; notBlocked?: NotBlocked[] }
/** #96: a call into a known package (mongodb, amqplib…) the loader does not count as blocked: a site plus the `package`, a `label` ("RabbitMQ — not mapped yet"), the `source` lines it judged by and the `transport`. */
export interface NotBlocked { fn: string; seq: number; package?: string; label?: string; transport?: string; call?: string; reason?: string; plain?: string; file?: string; line?: number; source?: string[]; url?: string | null }
export const SITE_CAP = 20;
/** A repository link is shown only when it is http(s); a harvester-supplied `source.url` such as `javascript:` is dropped. */
const httpUrl = (u: string | null | undefined) => (u && /^https?:\/\//i.test(u) ? u : null);

const num = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : undefined);
const str = (x: unknown) => (typeof x === 'string' ? x : undefined);
/** The coverage of an ingress (its `details`), or null when it reports none; anything malformed is dropped. `url` is added by the trace, never read from a harvester. */
export function coverageOf(details: Details | undefined | null): Coverage | null {
  const c = details?.coverage as Record<string, unknown> | undefined;
  if (!c || typeof c !== 'object') return null;
  const status = c.status === 'complete' || c.status === 'incomplete' ? c.status : undefined, blocked = num(c.blocked), more = num(c.more);
  const sites = Array.isArray(c.sites)
    ? c.sites.filter((s) => s && typeof s === 'object' && typeof (s as any).fn === 'string').map((s: any) => ({ fn: s.fn as string, seq: num(s.seq) ?? 0, ...(str(s.call) ? { call: s.call } : {}), ...(str(s.reason) ? { reason: s.reason } : {}), ...(str(s.plain) ? { plain: s.plain } : {}), ...(str(s.file) ? { file: s.file } : {}), ...(num(s.line) != null ? { line: num(s.line) } : {}) }))
    : undefined;
  const notBlocked = Array.isArray(c.notBlocked)
    ? c.notBlocked.filter((s) => s && typeof s === 'object' && typeof (s as any).fn === 'string').slice(0, SITE_CAP).map((s: any): NotBlocked => {
      const src = typeof s.source === 'string' ? [s.source] : Array.isArray(s.source) ? s.source.filter((x: unknown) => typeof x === 'string') : [];
      return { fn: s.fn as string, seq: num(s.seq) ?? 0, ...(['package', 'label', 'transport', 'call', 'reason', 'plain', 'file'] as const).reduce((o, k) => (str(s[k]) ? { ...o, [k]: s[k] } : o), {}), ...(num(s.line) != null ? { line: num(s.line) } : {}), ...(src.length ? { source: src } : {}) };
    })
    : undefined;
  return status || blocked != null || sites || more != null || notBlocked?.length ? { ...(status ? { status } : {}), ...(blocked != null ? { blocked } : {}), ...(sites ? { sites } : {}), ...(more != null ? { more } : {}), ...(notBlocked?.length ? { notBlocked } : {}) } : null;
}

/** `{ coverage }` for a trace of this ingress (its `details.coverage`, each site with its repository link, built like every other source link), or nothing. */
export function coverageFor(g: GraphIndex, ing: Ingress): { coverage?: Coverage } {
  const c = coverageOf(ing.details), svc = g.services.get(ing.service);
  if (!c) return {};
  const link = <T extends { file?: string; line?: number }>(s: T): T => { const u = httpUrl(svc && s.file ? codeLink(svc, { file: s.file, line: s.line })?.url : null); return u ? { ...s, url: u } : s; };
  return { coverage: { ...c, ...(c.sites ? { sites: c.sites.map(link) } : {}), ...(c.notBlocked ? { notBlocked: c.notBlocked.map(link) } : {}) } };
}

/** #96: the notBlocked entries of an ingress by `<fn>#<seq>`. */
export type NotBlockedIx = ReadonlyMap<string, NotBlocked>;
export const notBlockedIndex = (ing: Ingress | undefined): NotBlockedIx => new Map((coverageOf(ing?.details)?.notBlocked ?? []).map((e) => [`${e.fn}#${e.seq}`, e]));
/** #96: a frontier step that matches a notBlocked entry of the flow's own ingress is a classified leaf, never blocked: `{ label, notBlocked }` for its message, else null. */
export function notBlockedLeaf(ix: NotBlockedIx, fnId: string, st: Step): { label: string; notBlocked: { package?: string; label: string; transport?: string } } | null {
  const e = st.origin === 'frontier' ? ix.get(`${fnId}#${st.seq}`) : undefined;
  if (!e) return null;
  const label = e.label ?? e.plain ?? e.package ?? 'not a gap';
  return { label, notBlocked: { ...(e.package ? { package: e.package } : {}), label, ...(e.transport ? { transport: e.transport } : {}) } };
}

/** The blocked entry of a step (its own, else its egress's), or undefined. */
const gapEntry = (g: GraphIndex, service: string, st: Step): Unresolved | undefined =>
  st.unresolved?.find((u) => u.gap === true) ?? (st.type === 'egress' && st.target ? g.egress.get(sid(service, st.target))?.unresolved?.find((u) => u.gap === true) : undefined);

/** The site of a blocked step, or null when the step is not blocked. */
export function stepBlocked(g: GraphIndex, service: string, fnId: string, st: Step): BlockedSite | null {
  const u = gapEntry(g, service, st);
  if (!u) return null;
  const src = g.services.has(service) && st.source ? codeLink(g.services.get(service)!, st.source) : null, call = u.detail ?? st.operation ?? st.note;
  return { id: `${service}:${fnId}#${st.seq}`, service, fn: fnId, seq: st.seq, ...(call ? { call } : {}), reason: u.reason, ...(u.plain ? { plain: u.plain } : {}), ...(st.source?.file ? { file: st.source.file.replace(/^\.?\/+/, '') } : {}), ...(st.source?.line ? { line: st.source.line } : {}), ...(httpUrl(src?.url) ? { url: src!.url } : {}) };
}

/** The blocked steps in a function's frontier (its own frontier steps and those of the functions its frontier calls reach, each once): how many, and the first `SITE_CAP`. */
export function frontierBlocked(g: GraphIndex, service: string, fn: string, skip?: NotBlockedIx): { frontierBlocked?: number; frontierSites?: BlockedSite[] } {
  const seen = new Set<string>(), sites: BlockedSite[] = [];
  let n = 0;
  const walk = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const st of g.fns.get(sid(service, id))?.steps ?? []) {
      if (st.origin !== 'frontier') continue;
      const s = skip?.size && notBlockedLeaf(skip, id, st) ? null : stepBlocked(g, service, id, st);
      if (s) { n++; if (sites.length < SITE_CAP) sites.push(s); }
      if (st.type === 'call' && st.target) walk(st.target);
    }
  };
  walk(fn);
  return n ? { frontierBlocked: n, frontierSites: sites } : {};
}

/** The blocked sites of a trace, distinct by step id: the drawn messages first, then those of the folded frontier markers. `n` also counts what a marker did not list (past its 20). */
export function blockedSteps(t: Pick<Trace, 'messages'>): { sites: BlockedSite[]; n: number } {
  const byId = new Map<string, BlockedSite>();
  let unlisted = 0;
  for (const m of t.messages) if (m.blocked && !byId.has(m.blocked.id)) byId.set(m.blocked.id, m.blocked);
  for (const m of t.messages) {
    if (m.kind !== 'frontier' || !m.frontierBlocked) continue;
    const listed = m.frontierSites ?? [];
    for (const s of listed) if (!byId.has(s.id)) byId.set(s.id, s);
    unlisted += Math.max(0, m.frontierBlocked - listed.length);
  }
  return { sites: [...byId.values()], n: byId.size + unlisted };
}

const gapSeen = (m: Message) => !!m.blocked || m.gap?.gap !== undefined || !!m.frontierBlocked;

/** N of the trace (header badge, "Why incomplete" title): blocked steps in every service, folded frontier steps included. With no `gap` field anywhere on the trace: the ingress's `coverage.blocked` (its own service only). */
export function traceBlocked(t: Pick<Trace, 'messages'>, coverage?: Coverage | null): { n: number; source: 'trace' | 'coverage' | null } {
  if (t.messages.some(gapSeen)) return { n: blockedSteps(t).n, source: 'trace' };
  return coverage?.blocked != null ? { n: coverage.blocked, source: 'coverage' } : { n: 0, source: null };
}

/** N of a Flows list row: `coverage.blocked` only (the list has no trace). */
export const listBlocked = (coverage?: Coverage | null): number => coverage?.blocked ?? 0;
/** The harvester says the flow is incomplete (with or without a count). */
export const listIncomplete = (coverage?: Coverage | null): boolean => coverage?.status === 'incomplete' || listBlocked(coverage) > 0;

/** What "Why incomplete" lists: at most `cap` sites in trace order, how many more there are, and where they came from (the trace, or the ingress's coverage report). */
export function blockedSites(t: Pick<Trace, 'messages'> & { start?: { service: string } }, coverage?: Coverage | null, cap = SITE_CAP): { sites: BlockedSite[]; more: number; total: number; source: 'trace' | 'coverage' | null } {
  const { n, source } = traceBlocked(t, coverage);
  if (source === 'coverage') {
    const svc = t.start?.service ?? '', all = (coverage?.sites ?? []).map((s) => ({ ...s, id: `${svc}:${s.fn}#${s.seq}`, service: svc }));
    return { sites: all.slice(0, cap), more: Math.max(0, n - Math.min(all.length, cap)), total: n, source };
  }
  if (source !== 'trace') return { sites: [], more: 0, total: 0, source: null };
  const { sites } = blockedSteps(t);
  return { sites: sites.slice(0, cap), more: n - Math.min(sites.length, cap), total: n, source };
}

/** `{ blocked }` for a message of a blocked step, else nothing (the trace walker spreads it). */
export const blockedField = (g: GraphIndex, service: string, fnId: string, st: Step): { blocked?: BlockedSite } => { const b = stepBlocked(g, service, fnId, st); return b ? { blocked: b } : {}; };
