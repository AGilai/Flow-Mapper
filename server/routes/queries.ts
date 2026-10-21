// Read-only views over the resolved graph: system, service, trace, paths, search, health, changelog.

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { sid } from '../../core/graph-index.ts';
import { getEnvRow } from '../store/envs.ts';
import { systemGraph } from '../../core/system-graph.ts';
import { serviceView } from '../../core/service-view.ts';
import { trace } from '../../core/trace.ts';
import { entryPointsOut, refsFor, traceOut } from '../refs.ts';
import { flowCounts } from '../../core/flow-counts.ts';
import { findPaths } from '../../core/paths.ts';
import { search } from '../../core/search.ts';
import { health } from '../../core/health.ts';
import { healthHistory } from '../graph-cache.ts';
import { listChangelog, listEnvs } from '../store/snapshots.ts';
import { listBugs } from '../store/bugs.ts';

const int = (v: string | null, d: number) => (v && /^\d+$/.test(v) ? parseInt(v, 10) : d);

export function registerQueries(r: Router, ctx: Ctx) {

  r.get('/api/envs', () => listEnvs(ctx.db));

  r.get('/api/envs/:env/views/system', (req) => systemGraph(ctx.graphOf(req)));

  r.get('/api/envs/:env/views/service/:service', (req) => {
    const v = serviceView(ctx.graphOf(req), req.params.service);
    if (!v) throw notFound(`service '${req.params.service}'`);
    const bugs = listBugs(ctx.db, { service: req.params.service, open: true }, ctx.appVersion);
    return { ...v, openBugs: bugs.length };
  });

  r.get('/api/envs/:env/entry-points', (req) => entryPointsOut(ctx, req.params.env, req.query.get('draft')));
  r.get('/api/envs/:env/flows/counts', (req) => flowCounts(ctx.graphOf(req)));

  r.get('/api/envs/:env/trace', (req) => {
    const q = req.query;
    const service = q.get('service');
    if (!service) throw badRequest('service is required (plus ingress or fn)');
    const scope = q.get('scope') === 'intra' ? 'intra' : 'full';
    const g = ctx.graphOf(req);
    const t = trace(g, { service, ingress: q.get('ingress') ?? undefined, fn: q.get('fn') ?? undefined, event: q.get('event') ?? undefined },
      { scope, maxDepth: int(q.get('maxDepth'), 25), maxMessages: Math.min(int(q.get('maxMessages'), 500), 5000), expand: q.get('expand')?.split(',').filter(Boolean), frontier: ['1', 'true'].includes(q.get('frontier') ?? '') });
    const ing = q.get('ingress') ? g.ingress.get(sid(service, q.get('ingress')!)) : undefined;
    if (!t && ing && !g.fns.get(sid(service, ing.handler))) { // a copied endpoint: the endpoint came along, its functions did not
      const anchor = `ing:${service}/${ing.id}`, ref = refsFor(ctx, req.params.env, q.get('draft')).endpoints[anchor];
      const source = ref?.source ?? getEnvRow(ctx.db, req.params.env)?.source ?? null;
      throw conflict('NO_HANDLER', ref ? `This endpoint is a reference: its behaviour lives in ${source}` : `This endpoint's behaviour lives in ${source ?? 'another environment'}: ${req.params.env} holds the endpoint, not the functions behind it`,
        { source, service, ingress: ing.id, reference: !!ref, anchor });
    }
    if (!t) throw notFound('start point (service + ingress or fn)');
    return traceOut(ctx, req.params.env, q.get('draft'), t);
  });

  r.get('/api/envs/:env/paths', (req) => {
    const from = req.query.get('from'), to = req.query.get('to');
    if (!from || !to) throw badRequest('from and to are required service names');
    return findPaths(ctx.graphOf(req), from, to, Math.min(int(req.query.get('limit'), 5), 20));
  });

  r.get('/api/envs/:env/search', (req) => search(ctx.graphOf(req), req.query.get('q') ?? '', Math.min(int(req.query.get('limit'), 50), 500)));

  r.get('/api/envs/:env/health', (req) => health(ctx.graphOf(req)));

  r.get('/api/envs/:env/health/history', (req) => healthHistory(ctx.db, req.params.env, req.query.get('service') ?? undefined));

  r.get('/api/envs/:env/changelog', (req) => listChangelog(ctx.db, req.params.env, {
    service: req.query.get('service') ?? undefined,
    limit: Math.min(int(req.query.get('limit'), 50), 500),
    before: req.query.get('before') ? int(req.query.get('before'), 0) : undefined,
  }));

  /** Raw model for the static preview and for clients that want to run core/ locally. */
  r.get('/api/envs/:env/model', (req) => ctx.graphOf(req).model);
}
