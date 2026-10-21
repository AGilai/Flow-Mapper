// Ingest and the read routes of the map. See docs/API.md. Since 0.25.0 there are no routes that edit a service or an entity by hand:
// harvesters ingest into a sealed environment, a design is edited through a draft (edits, import, ops).

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

  /** One service's header and entities, from the database or (?draft=) from the draft's overlay. */
  const serviceOf = (req: Req) => ctx.readerOf(req).service(req.params.service) ?? (() => { throw notFound(`service '${req.params.service}' in env '${req.params.env}'`); })();
  r.get('/api/envs/:env/services/:service', (req) => { const v = serviceOf(req); return { service: v.service, ...v.entities }; });

  r.get('/api/envs/:env/services/:service/:list', (req) => serviceOf(req).entities[list(req.params.list)]);

  // Keys may contain '/' (channel bind keys), so the key is a rest segment.
  r.get('/api/envs/:env/services/:service/:list/*key', (req) => {
    const l = list(req.params.list);
    if (!req.query.get('draft')) return store.getEntity(db, req.params.env, req.params.service, l, req.params.key);
    return serviceOf(req).entities[l].find((e: any) => keyOf(l, e) === req.params.key) ?? (() => { throw notFound(`${l} '${req.params.key}' in service '${req.params.service}'`); })();
  });

  r.get('/api/meta/collections', () => LISTS);
}
