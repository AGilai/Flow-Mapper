// Endpoint info, event types, and their DTOs. See docs/API.md. Ingress ids and event types may
// contain '/', so they are the last (rest) segment of each path.

import type { Router } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { endpointInfo } from '../../core/endpoint-info.ts';
import { eventTypes, eventView } from '../../core/events.ts';
import { eventFlow } from '../../core/event-flow.ts';
import * as dtos from '../store/dtos.ts';
import { draftPrelude } from '../store/draft-prelude.ts';

/** PUT bodies are the DTO itself, so provenance rides in the query as JSON: ?meta={"source":{...}}. */
function queryMeta(q: URLSearchParams): unknown {
  const raw = q.get('meta');
  if (raw === null) return undefined;
  try { return JSON.parse(raw); } catch { throw badRequest('meta must be JSON'); }
}

export function registerDtos(r: Router, ctx: Ctx) {
  const { db } = ctx;

  r.get('/api/envs/:env/endpoints/:service/*ingress', (req) => {
    const { env, service, ingress } = req.params;
    const reader = ctx.readerOf(req);
    return endpointInfo(ctx.graphOf(req), service, ingress, reader.endpointDtos(service, ingress), reader.listEventDtos())
      ?? (() => { throw notFound(`ingress '${ingress}' of service '${service}'`); })();
  });

  r.get('/api/envs/:env/dtos', (req) =>
    ctx.readerOf(req).listDtos({ service: req.query.get('service') ?? undefined, ingress: req.query.get('ingress') ?? undefined }));

  r.post('/api/envs/:env/dtos', async (req) => {
    const dryRun = ['1', 'true'].includes(req.query.get('dryRun') ?? ''), draft = req.query.get('draft');
    const prelude = dryRun && draft ? draftPrelude(db, [{ env: req.params.env }], draft) : undefined;
    const out = dtos.loadDtos(db, req.params.env, (await req.json()).dtos, { dryRun, prelude });
    return dryRun ? out : created(out);
  });

  r.put('/api/envs/:env/dtos/:service/:role/*ingress', async (req) => {
    const { env, service, role, ingress } = req.params;
    return dtos.putDto(db, env, { service, ingress, role, status: req.query.get('status') ?? undefined, meta: queryMeta(req.query), content: await req.json() });
  });

  r.delete('/api/envs/:env/dtos/:service/:role/*ingress', (req) => {
    const { env, service, role, ingress } = req.params;
    return dtos.deleteDto(db, env, service, ingress, role, req.query.get('status') ?? undefined);
  });

  r.get('/api/envs/:env/events', (req) => {
    const has = new Set(ctx.readerOf(req).listEventDtos().map((d) => d.event));
    return eventTypes(ctx.graphOf(req)).map((t) => ({ ...t, hasDto: has.has(t.type) }));
  });

  r.get('/api/envs/:env/events/*type', (req) => {
    const g = ctx.graphOf(req);
    const t = eventView(g, req.params.type);
    const dto = ctx.readerOf(req).getEventDto(req.params.type);
    if (!t && !dto) throw notFound(`event type '${req.params.type}'`);
    return { ...(t ?? { type: req.params.type, producers: [], consumers: [] }), flow: eventFlow(g, req.params.type), dto };
  });

  r.put('/api/envs/:env/event-dtos/*type', async (req) =>
    dtos.putEventDto(db, req.params.env, { event: req.params.type, meta: queryMeta(req.query), content: await req.json() }));

  r.delete('/api/envs/:env/event-dtos/*type', (req) => dtos.deleteEventDto(db, req.params.env, req.params.type));
}
