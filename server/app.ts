// Wires the database, graph cache, routes, MCP endpoint and static UI into one HTTP handler.
// main.ts starts it; tests call createApp() with an in-memory database.

import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db/connection.ts';
import { Router, sendJson } from './http/router.ts';
import { serveStatic } from './http/static.ts';
import { afterWrite, graphFor, invalidateDraft, viewFor } from './graph-cache.ts';
import type { Ctx } from './context.ts';
import { registerEnvs } from './routes/envs.ts';
import { registerMap } from './routes/map.ts';
import { registerQueries } from './routes/queries.ts';
import { registerBugs } from './routes/bugs.ts';
import { registerDtos } from './routes/dtos.ts';
import { registerDescriptions } from './routes/descriptions.ts';
import { registerInventory } from './routes/inventory.ts';
import { registerInstances } from './routes/instances.ts';
import { registerDrafts } from './routes/drafts.ts';
import { registerMarks } from './routes/marks.ts';
import { registerDraftEdits } from './routes/draft-edits.ts';
import { registerMermaid } from './routes/mermaid.ts';
import { registerFlowNames } from './routes/flow-names.ts';
import { registerComments } from './routes/comments.ts';
import { registerFlowRelations } from './routes/flow-relations.ts';
import { registerSubsystems } from './routes/subsystems.ts';
import { getDraft } from './store/drafts.ts';
import { registerMcpHttp } from './mcp/http.ts';
import { registerEvents, type StreamOptions } from './routes/events.ts';
import { announceVersion } from './events/bus.ts';

export const APP_VERSION: string = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')).version;

export interface AppOptions { dbPath: string; dataDir: string; dev?: boolean; events?: StreamOptions }

export function createContext(opts: AppOptions): Ctx {
  const db = openDb(opts.dbPath);
  return {
    db, dataDir: opts.dataDir, appVersion: APP_VERSION,
    graph: (env) => graphFor(db, env),
    graphOf: (req) => viewFor(db, req.params.env, req.query.get('draft')).g,
    readerOf: (req) => viewFor(db, req.params.env, req.query.get('draft')).reader,
    view: (env, draft) => viewFor(db, env, draft ?? null),
    changed: (env) => afterWrite(db, env),
    changedDraft: (env, slug) => invalidateDraft(env, slug),
  };
}

export function createApp(opts: AppOptions): { server: Server; ctx: Ctx; router: Router } {
  const ctx = createContext(opts);
  announceVersion(ctx.db, ctx.appVersion);
  const router = new Router();
  router.get('/api/version', () => ({ version: APP_VERSION }));
  // Any GET under /api/envs/:env/ may carry ?draft=<slug>: an unknown draft is 404 and a closed one 409, whichever route it is.
  router.guard((req) => { const slug = req.query.get('draft'); if (req.method === 'GET' && slug && req.params.env) getDraft(ctx.db, req.params.env, slug); });
  registerEnvs(router, ctx);
  registerMap(router, ctx);
  registerQueries(router, ctx);
  registerBugs(router, ctx);
  registerDtos(router, ctx);
  registerDescriptions(router, ctx);
  registerInventory(router, ctx);
  registerInstances(router, ctx);
  registerDrafts(router, ctx);
  registerDraftEdits(router, ctx);
  registerMermaid(router, ctx);
  registerFlowNames(router, ctx);
  registerComments(router, ctx);
  registerSubsystems(router, ctx);
  registerFlowRelations(router, ctx);
  registerMarks(router, ctx);
  registerMcpHttp(router, ctx);
  registerEvents(router, ctx, opts.events);

  const server = createServer(async (req, res) => {
    if (await router.handle(req, res)) return;
    if (req.url?.startsWith('/api/')) return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'no such endpoint' } });
    if (await serveStatic(req, res, !!opts.dev)) return;
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } });
  });
  return { server, ctx, router };
}
