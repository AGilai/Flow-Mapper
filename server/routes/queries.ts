// Read-only views over the resolved graph: system, service, trace, paths, search, health, changelog.

import type { Router } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { badRequest, notFound } from '../errors.ts';
import { systemGraph } from '../../core/system-graph.ts';
import { serviceView } from '../../core/service-view.ts';
import { entryPoints, trace } from '../../core/trace.ts';
import { findPaths } from '../../core/paths.ts';
import { search } from '../../core/search.ts';
import { health } from '../../core/health.ts';
import { healthHistory } from '../graph-cache.ts';
import { listChangelog, listEnvs } from '../store/snapshots.ts';
import { listBugs } from '../store/bugs.ts';

const int = (v: string | null, d: number) => (v && /^\d+$/.test(v) ? parseInt(v, 10) : d);

export function registerQueries(r: Router, ctx: Ctx) {
  const g = (env: string) => ctx.graph(env);

  r.get('/api/envs', () => listEnvs(ctx.db));

  r.get('/api/envs/:env/views/system', (req) => systemGraph(g(req.params.env)));

  r.get('/api/envs/:env/views/service/:service', (req) => {
    const v = serviceView(g(req.params.env), req.params.service);
    if (!v) throw notFound(`service '${req.params.service}'`);
    const bugs = listBugs(ctx.db, { service: req.params.service, open: true }, ctx.appVersion);
    return { ...v, openBugs: bugs.length };
  });

  r.get('/api/envs/:env/entry-points', (req) => entryPoints(g(req.params.env)));

  r.get('/api/envs/:env/trace', (req) => {
    const q = req.query;
    const service = q.get('service');
    if (!service) throw badRequest('service is required (plus ingress or fn)');
    const scope = q.get('scope') === 'intra' ? 'intra' : 'full';
    const t = trace(g(req.params.env), { service, ingress: q.get('ingress') ?? undefined, fn: q.get('fn') ?? undefined, event: q.get('event') ?? undefined },
      { scope, maxDepth: int(q.get('maxDepth'), 25), maxMessages: Math.min(int(q.get('maxMessages'), 500), 5000), expand: q.get('expand')?.split(',').filter(Boolean) });
    if (!t) throw notFound('start point (service + ingress or fn)');
    return t;
  });

  r.get('/api/envs/:env/paths', (req) => {
    const from = req.query.get('from'), to = req.query.get('to');
    if (!from || !to) throw badRequest('from and to are required service names');
    return findPaths(g(req.params.env), from, to, Math.min(int(req.query.get('limit'), 5), 20));
  });

  r.get('/api/envs/:env/search', (req) => search(g(req.params.env), req.query.get('q') ?? '', Math.min(int(req.query.get('limit'), 50), 500)));

  r.get('/api/envs/:env/health', (req) => health(g(req.params.env)));

  r.get('/api/envs/:env/health/history', (req) => healthHistory(ctx.db, req.params.env, req.query.get('service') ?? undefined));

  r.get('/api/envs/:env/changelog', (req) => listChangelog(ctx.db, req.params.env, {
    service: req.query.get('service') ?? undefined,
    limit: Math.min(int(req.query.get('limit'), 50), 500),
    before: req.query.get('before') ? int(req.query.get('before'), 0) : undefined,
  }));

  /** Raw model for the static preview and for clients that want to run core/ locally. */
  r.get('/api/envs/:env/model', (req) => g(req.params.env).model);
}
