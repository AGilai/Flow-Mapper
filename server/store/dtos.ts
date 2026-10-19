// DTOs: per ingress endpoint (request / response body, queue message) and per event type (the
// message of that event, shared by its producers and consumers). Loaded separately from manifests
// (harvesters or people push them with their own API), so re-harvesting a service leaves them in place.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';
import { badRequest, notFound } from '../errors.ts';
import { DTO_ROLES, dtoSlots, type Dto, type DtoRole, type EventDto } from '../../core/endpoint-info.ts';

export interface DtoInput { service: string; ingress: string; role: string; content: unknown }
export interface EventDtoInput { event: string; content: unknown }
interface DtoRow { service: string; ingress: string; role: DtoRole; content: string; updated_at: string }

const rowToDto = (r: DtoRow) => ({ service: r.service, ingress: r.ingress, role: r.role, content: JSON.parse(r.content), updatedAt: r.updated_at });

export function listDtos(db: DB, env: string, filter: { service?: string; ingress?: string } = {}) {
  const rows = db.prepare(`SELECT service, ingress, role, content, updated_at FROM endpoint_dtos
    WHERE env = ? AND (? IS NULL OR service = ?) AND (? IS NULL OR ingress = ?) ORDER BY service, ingress, role`)
    .all(env, filter.service ?? null, filter.service ?? null, filter.ingress ?? null, filter.ingress ?? null) as unknown as DtoRow[];
  return rows.map(rowToDto);
}

/** DTOs of one endpoint, in the shape core/endpoint-info expects. */
export function endpointDtos(db: DB, env: string, service: string, ingress: string): Dto[] {
  return listDtos(db, env, { service, ingress }).map(({ role, content, updatedAt }) => ({ role, content, updatedAt }));
}

function check(db: DB, env: string, d: DtoInput) {
  if (!DTO_ROLES.includes(d.role as DtoRole)) throw badRequest(`role must be one of ${DTO_ROLES.join(', ')}`);
  if (d.content === undefined) throw badRequest('content is required');
  const row = db.prepare("SELECT data FROM entities WHERE env = ? AND service = ? AND list = 'ingress' AND key = ?").get(env, d.service, d.ingress) as { data: string } | undefined;
  if (!row) throw notFound(`ingress '${d.ingress}' of service '${d.service}' in env '${env}'`);
  const { slots, note } = dtoSlots(JSON.parse(row.data));
  if (!slots.some((x) => x.role === d.role)) {
    throw badRequest(`ingress '${d.ingress}' takes no ${d.role} DTO` + (slots.length ? ` (it takes: ${slots.map((x) => `${x.role} = ${x.label.toLowerCase()}`).join(', ')})` : ` (${note})`));
  }
}

function write(db: DB, env: string, d: DtoInput) {
  db.prepare(`INSERT INTO endpoint_dtos (env, service, ingress, role, content, updated_at) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (env, service, ingress, role) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`)
    .run(env, d.service, d.ingress, d.role, JSON.stringify(d.content), new Date().toISOString());
}

export function putDto(db: DB, env: string, d: DtoInput) {
  check(db, env, d);
  write(db, env, d);
  return listDtos(db, env, d).find((x) => x.role === d.role)!;
}

/** Load many DTOs in one transaction; nothing is written if any of them is invalid.
 *  Each item is an endpoint DTO {service, ingress, role, content} or an event DTO {event, content}. */
export function loadDtos(db: DB, env: string, items: unknown) {
  if (!Array.isArray(items)) throw badRequest('body must be {dtos: [{service, ingress, role, content} | {event, content}]}');
  return tx(db, () => {
    items.forEach((d: any, i) => {
      try {
        if (d && 'event' in d) { checkEvent(d); writeEvent(db, env, d); } else { check(db, env, d ?? {}); write(db, env, d); }
      } catch (err: any) { err.message = `dtos[${i}]: ${err.message}`; throw err; }
    });
    return { env, loaded: items.length };
  });
}

// ---------- event DTOs ----------

interface EventDtoRow { event_type: string; content: string; updated_at: string }
const rowToEventDto = (r: EventDtoRow): EventDto => ({ event: r.event_type, content: JSON.parse(r.content), updatedAt: r.updated_at });

export function listEventDtos(db: DB, env: string): EventDto[] {
  return (db.prepare('SELECT event_type, content, updated_at FROM event_dtos WHERE env = ? ORDER BY event_type').all(env) as unknown as EventDtoRow[]).map(rowToEventDto);
}

export function getEventDto(db: DB, env: string, event: string): EventDto | null {
  const r = db.prepare('SELECT event_type, content, updated_at FROM event_dtos WHERE env = ? AND event_type = ?').get(env, event) as EventDtoRow | undefined;
  return r ? rowToEventDto(r) : null;
}

function checkEvent(d: EventDtoInput) {
  if (typeof d.event !== 'string' || !d.event.trim()) throw badRequest('event is required');
  if (d.event.includes('*')) throw badRequest(`'${d.event}' is a pattern; a DTO belongs to one event type`);
  if (d.content === undefined) throw badRequest('content is required');
}

function writeEvent(db: DB, env: string, d: EventDtoInput) {
  db.prepare(`INSERT INTO event_dtos (env, event_type, content, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (env, event_type) DO UPDATE SET content = excluded.content, updated_at = excluded.updated_at`)
    .run(env, d.event, JSON.stringify(d.content), new Date().toISOString());
}

export function putEventDto(db: DB, env: string, d: EventDtoInput): EventDto {
  checkEvent(d);
  writeEvent(db, env, d);
  return getEventDto(db, env, d.event)!;
}

export function deleteEventDto(db: DB, env: string, event: string) {
  const r = db.prepare('DELETE FROM event_dtos WHERE env = ? AND event_type = ?').run(env, event);
  if (!r.changes) throw notFound(`DTO of event type '${event}'`);
  return { deleted: { event } };
}

export function deleteDto(db: DB, env: string, service: string, ingress: string, role: string) {
  const r = db.prepare('DELETE FROM endpoint_dtos WHERE env = ? AND service = ? AND ingress = ? AND role = ?').run(env, service, ingress, role);
  if (!r.changes) throw notFound(`${role} DTO of '${service}' ingress '${ingress}'`);
  return { deleted: { service, ingress, role } };
}
