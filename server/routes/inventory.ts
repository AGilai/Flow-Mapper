// Inventory and the detail views of data stores and channels, plus data-store schemas. See docs/API.md.
// Store and channel keys may contain '/', so they are the last (rest) segment of each path.

import type { Router } from '../http/router.ts';
import { created } from '../http/router.ts';
import type { Ctx, EnvReq } from '../context.ts';
import { notFound } from '../errors.ts';
import { inventory } from '../../core/inventory.ts';
import { stores } from '../../core/stores.ts';
import { listClients, storeWithClients } from '../../core/clients.ts';
import { channelView } from '../../core/channels.ts';
import * as schemas from '../store/schemas.ts';
import { allSummaries } from '../store/keys.ts';

export function registerInventory(r: Router, ctx: Ctx) {
  const { db } = ctx;
  const known = (req: EnvReq) => { const keys = new Set(stores(ctx.graphOf(req)).map((s) => s.key)); return (k: string) => keys.has(k); };

  r.get('/api/envs/:env/inventory', (req) => inventory(ctx.graphOf(req), ctx.readerOf(req).listEventDtos().map((d) => d.event), allSummaries(db, req.params.env)));

  r.get('/api/envs/:env/stores/*key', (req) => {
    const v = storeWithClients(ctx.graphOf(req), req.params.key) ?? (() => { throw notFound(`data store '${req.params.key}'`); })();
    return { ...v, schemas: ctx.readerOf(req).listSchemas(req.params.key) };
  });

  r.get('/api/envs/:env/clients', (req) => {
    const q = req.query;
    const f = Object.fromEntries(['store', 'service', 'driver', 'driverMajor', 'lib', 'accessMode', 'via'].map((k) => [k, q.get(k) ?? undefined]));
    return listClients(ctx.graphOf(req), f);
  });

  r.get('/api/envs/:env/channels/*key', (req) =>
    channelView(ctx.graphOf(req), req.params.key) ?? (() => { throw notFound(`channel '${req.params.key}'`); })());

  r.get('/api/envs/:env/schemas', (req) => ctx.readerOf(req).listSchemas(req.query.get('key') ?? undefined));

  r.post('/api/envs/:env/schemas', async (req) => {
    const dryRun = ['1', 'true'].includes(req.query.get('dryRun') ?? '');
    const out = schemas.loadSchemas(db, req.params.env, (await req.json()).schemas, known(req), { dryRun });
    return dryRun ? out : created(out);
  });

  r.put('/api/envs/:env/schemas/:source/*key', async (req) =>
    schemas.putSchema(db, req.params.env, { key: req.params.key, source: req.params.source, content: await req.json() }, known(req)));

  r.delete('/api/envs/:env/schemas/:source/*key', (req) => schemas.deleteSchema(db, req.params.env, req.params.key, req.params.source));
}
