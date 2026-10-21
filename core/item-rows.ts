// One row shape for everything the diff and the drafts touch: the encoding of `baseline_items` (and of `entities`).
//   header     key ''                      data = service header without `name` ({kind, ...meta}; env rows also carry version, harvestedAt, commit)
//   functions | ingress | egress | resources | channels | bindings    key = id (bindKey for channels), data = the entity
//   dto        key `ingress|role|status`   data {content, meta}      (status '' when none)
//   event_dto  service '', key = type      data {content, meta}
//   schema     service '', key `storeKey|source`   data = content
//   flow       key = ingress (drafts only) data {name?, description?, steps?, doc?}

import type { Model, Service } from './types.ts';
import { dtoLink, type Dto, type DtoMeta, type EventDto } from './endpoint-info.ts';

export interface ItemRow { service: string; list: string; key: string; data: any }
export const ENTITY_LISTS = ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings'] as const;
export const rowId = (r: Pick<ItemRow, 'service' | 'list' | 'key'>) => `${r.service}\u0000${r.list}\u0000${r.key}`;
/** A short human name of a row: the service, the id or key, `request of in.x` for a DTO, the store key of a schema. */
export function rowLabel(r: Pick<ItemRow, 'service' | 'list' | 'key'>): string {
  if (r.list === 'dto') { const rest = r.key.slice(0, r.key.lastIndexOf('|')), i = rest.lastIndexOf('|'); return `${rest.slice(i + 1)} of ${rest.slice(0, i)}`; }
  if (r.list === 'schema') return r.key.slice(0, r.key.lastIndexOf('|'));
  return r.list === 'header' ? r.service : r.key;
}
const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const byRow = (a: ItemRow, b: ItemRow) => cmp(a.service, b.service) || cmp(a.list, b.list) || cmp(a.key, b.key);

/** The same model `loadModel` builds from the tables: services by name, entities by (service, key), `service` attached, `steps ?? []`. */
export function rowsToModel(env: string, rows: ItemRow[]): Model {
  const model: Model = { env, services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };
  const sorted = [...rows].sort(byRow);
  for (const r of sorted) {
    if (r.list === 'header') {
      const { kind, version, harvestedAt, commit, ...meta } = r.data ?? {};
      model.services.push({ name: r.service, kind: kind ?? 'service', ...meta, version: version ?? 0, harvestedAt: harvestedAt ?? '', commit: commit ?? undefined } as Service);
    }
  }
  const known = new Set(model.services.map((s) => s.name));
  for (const r of sorted) {
    if (!(ENTITY_LISTS as readonly string[]).includes(r.list) || !known.has(r.service)) continue;
    const e = { ...r.data, service: r.service };
    if (r.list === 'functions') e.steps = e.steps ?? [];
    (model as any)[r.list].push(e);
  }
  return model;
}

export interface StoreSchemaRow { key: string; source: string; content: unknown; updatedAt: string }
export interface FlowText { name?: string; description?: string; steps?: unknown[]; doc?: unknown }
export interface DtoOut extends Dto { service: string; ingress: string; status: string }
export interface Extras { dtos: DtoOut[]; eventDtos: EventDto[]; schemas: StoreSchemaRow[]; flows: Map<string, FlowText> }

const lastBar = (key: string): [string, string] => { const i = key.lastIndexOf('|'); return [key.slice(0, i), key.slice(i + 1)]; };

/** DTOs, event DTOs, store schemas and flow texts of rows, in the store's output shapes (`updatedAt` is empty: rows carry no time). */
export function rowsToExtras(rows: ItemRow[]): Extras {
  const out: Extras = { dtos: [], eventDtos: [], schemas: [], flows: new Map() };
  for (const r of [...rows].sort(byRow)) {
    if (r.list === 'dto') {
      const [rest, status] = lastBar(r.key), [ingress, role] = lastBar(rest);
      out.dtos.push({ service: r.service, ingress, role: role as DtoOut['role'], status, content: r.data.content, meta: (r.data.meta ?? null) as DtoMeta | null, updatedAt: '' });
    } else if (r.list === 'event_dto') {
      const meta = (r.data.meta ?? null) as DtoMeta | null;
      out.eventDtos.push({ event: r.key, content: r.data.content, meta, link: dtoLink(meta), updatedAt: '' });
    } else if (r.list === 'schema') {
      const [key, source] = lastBar(r.key);
      out.schemas.push({ key, source, content: r.data, updatedAt: '' });
    } else if (r.list === 'flow') out.flows.set(`${r.service}/${r.key}`, r.data);
  }
  out.dtos.sort((a, b) => cmp(a.service, b.service) || cmp(a.ingress, b.ingress) || cmp(a.role, b.role) || cmp(a.status, b.status));
  out.eventDtos.sort((a, b) => cmp(a.event, b.event));
  out.schemas.sort((a, b) => cmp(a.key, b.key) || cmp(a.source, b.source));
  return out;
}
