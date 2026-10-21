// Where the non-graph reads of an environment come from: the database (dbReader) or, for a draft, the overlay rows
// (rowsReader). Routes and MCP tools ask `ctx.readerOf(req)` and never care which one they got.

import type { DB } from './db/connection.ts';
import { rowsToExtras, type ItemRow } from '../core/item-rows.ts';
import { overlayText } from '../core/flow-text.ts';
import type { Dto, EventDto } from '../core/endpoint-info.ts';
import type { Service } from '../core/types.ts';
import * as dtos from './store/dtos.ts';
import * as schemas from './store/schemas.ts';
import { LISTS } from './schema.ts';
import { getService, loadEntities, type Entities } from './store/snapshots-read.ts';

export interface FlowText { name?: string; description?: string }
export interface DataReader {
  endpointDtos(service: string, ingress: string): Dto[];
  listDtos(filter?: { service?: string; ingress?: string }): ReturnType<typeof dtos.listDtos>;
  listEventDtos(): EventDto[];
  getEventDto(type: string): EventDto | null;
  listSchemas(key?: string): schemas.StoreSchema[];
  /** The name and (human) description of a flow, if any. */
  flowText(service: string, ingress: string): FlowText | null;
  /** Every flow text of the environment, by `<service>/<ingress>` (one read for a whole entry list). */
  flowTexts(): Map<string, FlowText>;
  /** One service's header and entities; null when the service is not there. */
  service(name: string): { service: Service; entities: Required<Entities> } | null;
}

export function dbReader(db: DB, env: string): DataReader {
  return {
    endpointDtos: (s, i) => dtos.endpointDtos(db, env, s, i),
    listDtos: (f) => dtos.listDtos(db, env, f),
    listEventDtos: () => dtos.listEventDtos(db, env),
    getEventDto: (t) => dtos.getEventDto(db, env, t),
    listSchemas: (k) => schemas.listSchemas(db, env, k),
    flowText(service, ingress) {
      const n = db.prepare('SELECT name FROM flow_names WHERE env = ? AND service = ? AND ingress = ?').get(env, service, ingress) as { name: string } | undefined;
      const d = db.prepare("SELECT text FROM descriptions WHERE env = ? AND service = ? AND ingress = ? AND callee = '' AND source = 'human'").get(env, service, ingress) as { text: string } | undefined;
      return n || d ? { ...(n ? { name: n.name } : {}), ...(d ? { description: d.text } : {}) } : null;
    },
    flowTexts() {
      const out = new Map<string, FlowText>();
      for (const r of db.prepare('SELECT service, ingress, name FROM flow_names WHERE env = ?').all(env) as { service: string; ingress: string; name: string }[]) out.set(`${r.service}/${r.ingress}`, { name: r.name });
      for (const r of db.prepare("SELECT service, ingress, text FROM descriptions WHERE env = ? AND callee = '' AND source = 'human'").all(env) as { service: string; ingress: string; text: string }[]) {
        out.set(`${r.service}/${r.ingress}`, { ...out.get(`${r.service}/${r.ingress}`), description: r.text });
      }
      return out;
    },
    service(name) {
      try { return { service: getService(db, env, name), entities: loadEntities(db, env, name) }; } catch { return null; }
    },
  };
}

/** Reads from the overlay rows; a flow's name and description the draft says nothing about come from `fallback` (the database). */
export function rowsReader(rows: ItemRow[], fallback: DataReader): DataReader {
  const x = rowsToExtras(rows);
  const header = new Map(rows.filter((r) => r.list === 'header').map((r) => [r.service, r]));
  return {
    endpointDtos: (s, i) => x.dtos.filter((d) => d.service === s && d.ingress === i).map(({ role, status, content, meta, updatedAt }) => ({ role, status, content, meta, updatedAt })),
    listDtos: (f = {}) => x.dtos.filter((d) => (!f.service || d.service === f.service) && (!f.ingress || d.ingress === f.ingress)) as ReturnType<typeof dtos.listDtos>,
    listEventDtos: () => x.eventDtos,
    getEventDto: (t) => x.eventDtos.find((d) => d.event === t) ?? null,
    listSchemas: (k) => x.schemas.filter((s) => !k || s.key === k),
    flowText: (service, ingress) => overlayText(x.flows.get(`${service}/${ingress}`), fallback.flowText(service, ingress)),
    flowTexts() {
      const out = fallback.flowTexts();
      for (const [k, op] of x.flows) { const t = overlayText(op, out.get(k)); if (t) out.set(k, t); else out.delete(k); }
      return out;
    },
    service(name) {
      const h = header.get(name);
      if (!h) return null;
      const { kind, version, harvestedAt, commit, ...meta } = h.data;
      const entities = Object.fromEntries(LISTS.map((l) => [l, rows.filter((r) => r.service === name && r.list === l).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)).map((r) => r.data)])) as Required<Entities>;
      return { service: { name, kind: kind ?? 'service', ...meta, version: version ?? 0, harvestedAt: harvestedAt ?? '', commit }, entities };
    },
  };
}
