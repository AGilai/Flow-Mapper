// Wires the database, graph cache, routes, MCP endpoint and static UI into one HTTP handler.
// main.ts starts it; tests call createApp() with an in-memory database.

import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openDb } from './db/connection.ts';
import { Router, sendJson } from './http/router.ts';
import { serveStatic } from './http/static.ts';
import { afterWrite, graphFor } from './graph-cache.ts';
import type { Ctx } from './context.ts';
import { registerMap } from './routes/map.ts';
import { registerQueries } from './routes/queries.ts';
import { registerBugs } from './routes/bugs.ts';
import { registerDtos } from './routes/dtos.ts';
import { registerMcpHttp } from './mcp/http.ts';

export const APP_VERSION: string = JSON.parse(readFileSync(join(import.meta.dirname, '../package.json'), 'utf8')).version;

export interface AppOptions { dbPath: string; dataDir: string; dev?: boolean }

export function createContext(opts: AppOptions): Ctx {
  const db = openDb(opts.dbPath);
  return {
    db, dataDir: opts.dataDir, appVersion: APP_VERSION,
    graph: (env) => graphFor(db, env),
    changed: (env) => afterWrite(db, env),
  };
}

export function createApp(opts: AppOptions): { server: Server; ctx: Ctx } {
  const ctx = createContext(opts);
  const router = new Router();
  router.get('/api/version', () => ({ version: APP_VERSION }));
  registerMap(router, ctx);
  registerQueries(router, ctx);
  registerBugs(router, ctx);
  registerDtos(router, ctx);
  registerMcpHttp(router, ctx);

  const server = createServer(async (req, res) => {
    if (await router.handle(req, res)) return;
    if (req.url?.startsWith('/api/')) return sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'no such endpoint' } });
    if (await serveStatic(req, res, !!opts.dev)) return;
    sendJson(res, 404, { error: { code: 'NOT_FOUND', message: 'not found' } });
  });
  return { server, ctx };
}
