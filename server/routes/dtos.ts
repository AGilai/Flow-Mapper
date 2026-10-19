// Endpoint info, event types, and their DTOs. See docs/API.md. Ingress ids and event types may
// contain '/', so they are the last (rest) segment of each path.

import type { Router } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { notFound } from '../errors.ts';
import { endpointInfo } from '../../core/endpoint-info.ts';
import { eventTypes } from '../../core/events.ts';
import * as dtos from '../store/dtos.ts';

export function registerDtos(r: Router, ctx: Ctx) {
  const { db } = ctx;

  r.get('/api/envs/:env/endpoints/:service/*ingress', (req) => {
    const { env, service, ingress } = req.params;
    return endpointInfo(ctx.graph(env), service, ingress, dtos.endpointDtos(db, env, service, ingress), dtos.listEventDtos(db, env))
      ?? (() => { throw notFound(`ingress '${ingress}' of service '${service}'`); })();
  });

  r.get('/api/envs/:env/dtos', (req) =>
    dtos.listDtos(db, req.params.env, { service: req.query.get('service') ?? undefined, ingress: req.query.get('ingress') ?? undefined }));

  r.post('/api/envs/:env/dtos', async (req) => created(dtos.loadDtos(db, req.params.env, (await req.json()).dtos)));

  r.put('/api/envs/:env/dtos/:service/:role/*ingress', async (req) => {
    const { env, service, role, ingress } = req.params;
    return dtos.putDto(db, env, { service, ingress, role, content: await req.json() });
  });

  r.delete('/api/envs/:env/dtos/:service/:role/*ingress', (req) => {
    const { env, service, role, ingress } = req.params;
    return dtos.deleteDto(db, env, service, ingress, role);
  });

  r.get('/api/envs/:env/events', (req) => {
    const has = new Set(dtos.listEventDtos(db, req.params.env).map((d) => d.event));
    return eventTypes(ctx.graph(req.params.env)).map((t) => ({ ...t, hasDto: has.has(t.type) }));
  });

  r.get('/api/envs/:env/events/*type', (req) => {
    const t = eventTypes(ctx.graph(req.params.env)).find((x) => x.type === req.params.type);
    const dto = dtos.getEventDto(db, req.params.env, req.params.type);
    if (!t && !dto) throw notFound(`event type '${req.params.type}'`);
    return { ...(t ?? { type: req.params.type, producers: [], consumers: [] }), dto };
  });

  r.put('/api/envs/:env/event-dtos/*type', async (req) =>
    dtos.putEventDto(db, req.params.env, { event: req.params.type, content: await req.json() }));

  r.delete('/api/envs/:env/event-dtos/*type', (req) => dtos.deleteEventDto(db, req.params.env, req.params.type));
}
