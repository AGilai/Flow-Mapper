// Ingest and CRUD for the map. See docs/API.md.

import type { Router } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { isList, keyOf, LISTS } from '../schema.ts';
import * as store from '../store/snapshots.ts';
import { health } from '../../core/health.ts';

export function registerMap(r: Router, ctx: Ctx) {
  const { db } = ctx;
  const list = (name: string) => { if (!isList(name)) throw notFound(`collection '${name}'`); return name; };
  const source = (q: URLSearchParams) => (q.get('source') === 'ui' ? 'ui' : 'api');

  r.post('/api/ingest', async (req) => {
    const body = await req.json();
    const manifests = Array.isArray(body?.manifests) ? body.manifests : [body];
    const results = manifests.map((m: any) => store.ingest(db, m, source(req.query)));
    new Set(results.map((x: any) => x.env)).forEach((env) => ctx.changed(env as string));
    return created({ results });
  });

  r.get('/api/envs/:env/services', (req) => {
    const h = new Map(health(ctx.graph(req.params.env)).services.map((s) => [s.service, s]));
    return ctx.graph(req.params.env).model.services.map((s) => ({ ...s, health: h.get(s.name) }));
  });

  r.post('/api/envs/:env/services', async (req) => {
    const out = store.createService(db, req.params.env, await req.json(), source(req.query));
    ctx.changed(req.params.env);
    return created(out);
  });

  r.get('/api/envs/:env/services/:service', (req) => ({
    service: store.getService(db, req.params.env, req.params.service),
    ...store.loadEntities(db, req.params.env, req.params.service),
  }));

  r.patch('/api/envs/:env/services/:service', async (req) => {
    const out = store.updateService(db, req.params.env, req.params.service, await req.json(), source(req.query));
    ctx.changed(req.params.env);
    return out;
  });

  r.delete('/api/envs/:env/services/:service', (req) => {
    const out = store.deleteService(db, req.params.env, req.params.service, source(req.query));
    ctx.changed(req.params.env);
    return out;
  });

  r.get('/api/envs/:env/services/:service/:list', (req) => {
    store.getService(db, req.params.env, req.params.service);
    return store.loadEntities(db, req.params.env, req.params.service)[list(req.params.list)];
  });

  r.post('/api/envs/:env/services/:service/:list', async (req) => {
    const l = list(req.params.list);
    const body = await req.json();
    const existing = store.loadEntities(db, req.params.env, req.params.service)[l];
    if (existing.some((e: any) => keyOf(l, e) === keyOf(l, body))) throw badRequest(`${l} '${keyOf(l, body)}' already exists; use PUT to replace`);
    const out = store.upsertEntity(db, req.params.env, req.params.service, l, body, source(req.query));
    ctx.changed(req.params.env);
    return created(out);
  });

  // Keys may contain '/' (channel bind keys), so the key is a rest segment.
  r.get('/api/envs/:env/services/:service/:list/*key', (req) =>
    store.getEntity(db, req.params.env, req.params.service, list(req.params.list), req.params.key));

  r.put('/api/envs/:env/services/:service/:list/*key', async (req) => {
    const l = list(req.params.list);
    const body = await req.json();
    if (keyOf(l, body) !== req.params.key) throw badRequest(`body ${l === 'channels' ? 'bindKey' : 'id'} must equal '${req.params.key}'`);
    const out = store.upsertEntity(db, req.params.env, req.params.service, l, body, source(req.query));
    ctx.changed(req.params.env);
    return out;
  });

  r.delete('/api/envs/:env/services/:service/:list/*key', (req) => {
    const out = store.deleteEntity(db, req.params.env, req.params.service, list(req.params.list), req.params.key, source(req.query));
    ctx.changed(req.params.env);
    return out;
  });

  r.get('/api/meta/collections', () => LISTS);
}
