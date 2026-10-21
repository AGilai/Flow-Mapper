// Ingest and CRUD for the map. See docs/API.md.

import type { Req, Router } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { isList, keyOf, LISTS } from '../schema.ts';
import * as store from '../store/snapshots.ts';
import { health } from '../../core/health.ts';
import { draftPrelude } from '../store/draft-prelude.ts';

export function registerMap(r: Router, ctx: Ctx) {
  const { db } = ctx;
  const list = (name: string) => { if (!isList(name)) throw notFound(`collection '${name}'`); return name; };
  const source = (q: URLSearchParams) => (q.get('source') === 'ui' ? 'ui' : 'api');

  r.post('/api/ingest', async (req) => {
    const body = await req.json();
    const manifests = Array.isArray(body?.manifests) ? body.manifests : [body];
    // ?dryRun=1: validate and diff against what is stored, write nothing; allowed into a design environment too.
    // &draft=<slug> (dry runs only): check the manifests against the environment as that open draft would leave it.
    const dryRun = req.query.get('dryRun') === '1' || req.query.get('dryRun') === 'true';
    const draft = req.query.get('draft');
    if (draft && !dryRun) throw badRequest('draft is for dry runs only (dryRun=1): a real ingest does not go through a draft');
    const results = store.ingestBatch(db, manifests, source(req.query), { dryRun, prelude: draft ? draftPrelude(db, manifests, draft) : undefined }); // one transaction: all or nothing
    if (dryRun) return { dryRun: true, results };
    new Set(results.map((x: any) => x.env)).forEach((env) => ctx.changed(env as string));
    return created({ results });
  });

  r.get('/api/envs/:env/services', (req) => {
    const g = ctx.graphOf(req);
    const h = new Map(health(g).services.map((s) => [s.service, s]));
    return g.model.services.map((s) => ({ ...s, health: h.get(s.name) }));
  });

  r.post('/api/envs/:env/services', async (req) => {
    const out = store.createService(db, req.params.env, await req.json(), source(req.query));
    ctx.changed(req.params.env);
    return created(out);
  });

  /** One service's header and entities, from the database or (?draft=) from the draft's overlay. */
  const serviceOf = (req: Req) => ctx.readerOf(req).service(req.params.service) ?? (() => { throw notFound(`service '${req.params.service}' in env '${req.params.env}'`); })();
  r.get('/api/envs/:env/services/:service', (req) => { const v = serviceOf(req); return { service: v.service, ...v.entities }; });

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

  r.get('/api/envs/:env/services/:service/:list', (req) => serviceOf(req).entities[list(req.params.list)]);

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
  r.get('/api/envs/:env/services/:service/:list/*key', (req) => {
    const l = list(req.params.list);
    if (!req.query.get('draft')) return store.getEntity(db, req.params.env, req.params.service, l, req.params.key);
    return serviceOf(req).entities[l].find((e: any) => keyOf(l, e) === req.params.key) ?? (() => { throw notFound(`${l} '${req.params.key}' in service '${req.params.service}'`); })();
  });

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
