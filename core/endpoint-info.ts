// Endpoint info: an ingress, the function that handles it, a link to that code in the service's
// repository, and its DTOs, named for the kind of endpoint (message, request body, response body).
// Pure; used by the server and the static preview.

import type { GraphIndex } from './graph-index.ts';
import type { Fn, Ingress, Service, Source } from './types.ts';
import { ingressEvents, type EventRow } from './events.ts';
import { egressVia, type LinkedHop } from './via.ts';

export type DtoRole = 'request' | 'response';
export const DTO_ROLES: DtoRole[] = ['request', 'response'];
/** Where a DTO came from, as the harvester reports it. All optional. `incomplete` is the reason it is partial. */
export interface DtoMeta { source?: { repo?: string; ref?: string; file?: string; line?: number }; provenance?: string; incomplete?: string | boolean }
/** `status` is '' for the success response, else '404', '4xx' or 'default'. `link` is the web link to meta.source. */
export interface Dto { role: DtoRole; status?: string; content: unknown; meta?: DtoMeta | null; link?: SourceLink | null; updatedAt: string }

export interface SourceLink { repo: string; url: string | null; ref: string; file?: string; line?: number }
/** A DTO an endpoint can have, with the name people use for it. `dto` is set when one is stored. */
export interface DtoSlot { role: DtoRole; status: string; label: string; dto: Dto | null; stale: boolean }
export interface EventDto { event: string; content: unknown; meta?: DtoMeta | null; link?: SourceLink | null; updatedAt: string }
/** One event type at a consumer, with its handler's code link and the event type's Message DTO. */
export type ProducerInfo = EventRow['producers'][number] & { via?: LinkedHop[] };
export interface EventInfo extends Omit<EventRow, 'producers'> { producers: ProducerInfo[]; source: SourceLink | null; dto: EventDto | null }
export interface EndpointInfo {
  service: string; ingress: Ingress; method: string | null; handler: Fn | null; source: SourceLink | null;
  harvestedAt: string; slots: DtoSlot[]; note: string | null; events: EventInfo[];
  /** Where the route / consumer itself is declared, when the harvester reports it. */
  definedAt: SourceLink | null;
}

const BODY_METHODS = ['POST', 'PUT', 'PATCH'];
const NO_BODY_METHODS = ['GET', 'DELETE', 'HEAD', 'OPTIONS'];

/** HTTP method from details.method or the bind key (http:POST host/path). */
export function httpMethod(i: Ingress): string | null {
  if (i.transport !== 'http') return null;
  const m = (i.details as any)?.method ?? i.bindKey.match(/^http:([A-Za-z]+)\s/)?.[1];
  return m ? String(m).toUpperCase() : null;
}

/** Success first, then error responses by status: 400 before 4xx, classes after codes, default last. */
export function compareStatus(a: string, b: string): number {
  const rank = (s: string) => (s === '' ? 0 : s === 'default' ? 3 : s.endsWith('xx') ? 2 : 1);
  return rank(a) - rank(b) || a.localeCompare(b);
}

/** Link to the file and line a DTO was derived from; null when its meta has no repo and no service repo applies. */
export function dtoLink(meta: DtoMeta | null | undefined, svc?: Service): SourceLink | null {
  const s = meta?.source;
  if (!s || !(s.file || s.repo)) return null;
  return codeLink(svc ?? ({} as Service), { repo: s.repo, commit: s.ref, file: s.file, line: s.line });
}

/** Which DTOs make sense for an endpoint: queues and topics carry one message, a GET has no body, a cron has none. */
export function dtoSlots(i: Ingress): { slots: { role: DtoRole; label: string }[]; note: string | null } {
  if (i.events?.length) return { slots: [], note: null }; // messages are described per event type
  switch (i.transport) {
    case 'sqs': case 'sns': case 'amqp': case 'eventbridge': return { slots: [{ role: 'request', label: 'Message' }], note: null };
    case 'event': return { slots: [{ role: 'request', label: 'Event' }], note: null };
    case 'cron': return { slots: [], note: 'Runs on a schedule, so there is no payload.' };
    case 'rpc': return { slots: [{ role: 'request', label: 'Request' }, { role: 'response', label: 'Response' }], note: null };
    case 'grpc': return { slots: [{ role: 'request', label: 'Request message' }, { role: 'response', label: 'Response message' }], note: null };
    case 'http': {
      const m = httpMethod(i);
      if (m && NO_BODY_METHODS.includes(m)) return { slots: [{ role: 'request', label: 'Query / path params' }, { role: 'response', label: 'Response body' }], note: `${m} requests have no body; the request DTO holds its path and query params.` };
      return { slots: [{ role: 'request', label: m && BODY_METHODS.includes(m) ? 'Request body' : 'Request' }, { role: 'response', label: 'Response body' }], note: null };
    }
    default: return { slots: [{ role: 'request', label: 'Request' }, { role: 'response', label: 'Response' }], note: null };
  }
}

/** Web URL for a repo given as https://host/org/repo(.git), host/org/repo or git@host:org/repo.git. */
export function repoUrl(repo: string): string | null {
  const s = repo.trim().replace(/\/+$/, '').replace(/\.git$/, '');
  const ssh = s.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/);
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`;
  if (/^https?:\/\//.test(s)) return s;
  if (/^[\w-]+(\.[\w-]+)+\/.+/.test(s)) return `https://${s}`;
  return null;
}

/** Where the handler's code starts: file and line at the harvested commit (GitHub/GitLab /blob/ URLs). */
export function sourceLink(svc: Service, fn: Fn | null): SourceLink | null {
  return codeLink(svc, fn ? { file: fn.file, line: fn.line, commit: fn.commit } : {});
}

/** Link to an item's own source (ingress, egress, channel, binding, resource). Its url, repo and
 *  commit win over the service's, so items scanned at another commit still point at the right lines. */
export function codeLink(svc: Service, src: Source | undefined | null): SourceLink | null {
  if (!src) return null;
  const repo = src.repo ?? svc.repo;
  const ref = src.commit ?? svc.commit ?? 'HEAD';
  const file = src.file?.replace(/^\.?\/+/, '');
  if (src.url) return { repo: repo ?? '', url: src.url, ref, file, line: src.line };
  if (!repo) return null;
  const base = repoUrl(repo);
  const url = base && file ? `${base}/blob/${ref}/${file}${src.line ? `#L${src.line}` : ''}` : base;
  return { repo, url, ref, file, line: src.line };
}

export function endpointInfo(g: GraphIndex, service: string, ingressId: string, dtos: Dto[], eventDtos: EventDto[] = []): EndpointInfo | null {
  const svc = g.model.services.find((s) => s.name === service);
  const ingress = g.model.ingress.find((i) => i.service === service && i.id === ingressId);
  if (!svc || !ingress) return null;
  const handler = g.model.functions.find((f) => f.service === service && f.id === ingress.handler) ?? null;
  const { slots, note } = dtoSlots(ingress);
  return {
    service, ingress, method: httpMethod(ingress), handler, source: sourceLink(svc, handler), harvestedAt: svc.harvestedAt, note,
    definedAt: codeLink(svc, ingress.source),
    events: ingressEvents(g, ingress).map((r) => ({
      ...r,
      producers: r.producers.map((p) => withVia(g, p)),
      source: r.handler ? sourceLink(svc, g.model.functions.find((f) => f.service === service && f.id === r.handler) ?? null) : null,
      dto: eventDtos.find((d) => d.event === r.type) ?? null,
    })),
    // A DTO loaded before the service was last harvested may describe older code.
    slots: withErrorResponses(slots, dtos).map((x) => {
      const dto = dtos.find((d) => d.role === x.role && (d.status ?? '') === x.status) ?? null;
      return { ...x, dto: dto && { ...dto, link: dtoLink(dto.meta, svc) }, stale: !!dto && dto.updatedAt < svc.harvestedAt };
    }),
  };
}

/** A producer with the wrapper chain of its egress (display only: the producer stays the calling service). */
function withVia(g: GraphIndex, p: EventRow['producers'][number]): ProducerInfo {
  const e = p.egress ? g.model.egress.find((x) => x.service === p.service && x.id === p.egress) : undefined;
  const svc = e && g.model.services.find((s) => s.name === e.service);
  const via = e && svc ? egressVia(svc, e).via : [];
  return via.length ? { ...p, via } : p;
}

/** The endpoint's slots, with one more response slot per stored error status ("Response 404"). */
function withErrorResponses(slots: { role: DtoRole; label: string }[], dtos: Dto[]): { role: DtoRole; status: string; label: string }[] {
  const out = slots.map((x) => ({ ...x, status: '' }));
  if (!slots.some((x) => x.role === 'response')) return out;
  const errors = [...new Set(dtos.filter((d) => d.role === 'response' && d.status).map((d) => d.status!))].sort(compareStatus);
  return [...out, ...errors.map((status) => ({ role: 'response' as const, status, label: `Response ${status}` }))];
}
