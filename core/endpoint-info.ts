// Endpoint info: an ingress, the function that handles it, a link to that code in the service's
// repository, and its DTOs, named for the kind of endpoint (message, request body, response body).
// Pure; used by the server and the static preview.

import type { GraphIndex } from './graph-index.ts';
import type { Fn, Ingress, Service } from './types.ts';
import { ingressEvents, type EventRow } from './events.ts';

export type DtoRole = 'request' | 'response';
export const DTO_ROLES: DtoRole[] = ['request', 'response'];
export interface Dto { role: DtoRole; content: unknown; updatedAt: string }

export interface SourceLink { repo: string; url: string | null; ref: string; file?: string; line?: number }
/** A DTO an endpoint can have, with the name people use for it. `dto` is set when one is stored. */
export interface DtoSlot { role: DtoRole; label: string; dto: Dto | null; stale: boolean }
export interface EventDto { event: string; content: unknown; updatedAt: string }
/** One event type at a consumer, with its handler's code link and the event type's Message DTO. */
export interface EventInfo extends EventRow { source: SourceLink | null; dto: EventDto | null }
export interface EndpointInfo {
  service: string; ingress: Ingress; method: string | null; handler: Fn | null; source: SourceLink | null;
  harvestedAt: string; slots: DtoSlot[]; note: string | null; events: EventInfo[];
}

const BODY_METHODS = ['POST', 'PUT', 'PATCH'];
const NO_BODY_METHODS = ['GET', 'DELETE', 'HEAD', 'OPTIONS'];

/** HTTP method from details.method or the bind key (http:POST host/path). */
export function httpMethod(i: Ingress): string | null {
  if (i.transport !== 'http') return null;
  const m = (i.details as any)?.method ?? i.bindKey.match(/^http:([A-Za-z]+)\s/)?.[1];
  return m ? String(m).toUpperCase() : null;
}

/** Which DTOs make sense for an endpoint: queues and topics carry one message, a GET has no body, a cron has none. */
export function dtoSlots(i: Ingress): { slots: { role: DtoRole; label: string }[]; note: string | null } {
  if (i.events?.length) return { slots: [], note: null }; // messages are described per event type
  switch (i.transport) {
    case 'sqs': case 'sns': case 'amqp': case 'eventbridge': return { slots: [{ role: 'request', label: 'Message' }], note: null };
    case 'event': return { slots: [{ role: 'request', label: 'Event' }], note: null };
    case 'cron': return { slots: [], note: 'Runs on a schedule, so there is no payload.' };
    case 'grpc': return { slots: [{ role: 'request', label: 'Request message' }, { role: 'response', label: 'Response message' }], note: null };
    case 'http': {
      const m = httpMethod(i);
      if (m && NO_BODY_METHODS.includes(m)) return { slots: [{ role: 'response', label: 'Response body' }], note: `${m} requests have no body.` };
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
  if (!svc.repo) return null;
  const base = repoUrl(svc.repo);
  const ref = svc.commit ?? 'HEAD';
  const file = fn?.file?.replace(/^\.?\/+/, '');
  const url = base && file ? `${base}/blob/${ref}/${file}${fn?.line ? `#L${fn.line}` : ''}` : base;
  return { repo: svc.repo, url, ref, file, line: fn?.line };
}

export function endpointInfo(g: GraphIndex, service: string, ingressId: string, dtos: Dto[], eventDtos: EventDto[] = []): EndpointInfo | null {
  const svc = g.model.services.find((s) => s.name === service);
  const ingress = g.model.ingress.find((i) => i.service === service && i.id === ingressId);
  if (!svc || !ingress) return null;
  const handler = g.model.functions.find((f) => f.service === service && f.id === ingress.handler) ?? null;
  const { slots, note } = dtoSlots(ingress);
  return {
    service, ingress, method: httpMethod(ingress), handler, source: sourceLink(svc, handler), harvestedAt: svc.harvestedAt, note,
    events: ingressEvents(g, ingress).map((r) => ({
      ...r,
      source: r.handler ? sourceLink(svc, g.model.functions.find((f) => f.service === service && f.id === r.handler) ?? null) : null,
      dto: eventDtos.find((d) => d.event === r.type) ?? null,
    })),
    // A DTO loaded before the service was last harvested may describe older code.
    slots: slots.map((x) => {
      const dto = dtos.find((d) => d.role === x.role) ?? null;
      return { ...x, dto, stale: !!dto && dto.updatedAt < svc.harvestedAt };
    }),
  };
}
