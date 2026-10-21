// Tiny router on node:http. Routes are `METHOD /path/:param`; handlers return a value (sent as JSON)
// or a Reply for other content types. Errors become JSON {error: {code, message, details}}.

import type { IncomingMessage, ServerResponse } from 'node:http';
import { HttpError, badRequest } from '../errors.ts';

export interface Req {
  method: string;
  path: string;
  params: Record<string, string>;
  query: URLSearchParams;
  headers: IncomingMessage['headers'];
  body: () => Promise<Buffer>;
  json: () => Promise<any>;
}
export class Reply {
  status: number; headers: Record<string, string>; body: string | Buffer;
  constructor(status: number, body: string | Buffer, headers: Record<string, string> = {}) {
    this.status = status; this.body = body; this.headers = headers;
  }
}
export type Handler = (req: Req) => unknown | Promise<unknown>;

interface Route { method: string; parts: string[]; handler: Handler }

const MAX_BODY = 10 * 1024 * 1024;

export class Router {
  private routes: Route[] = [];

  on(method: string, path: string, handler: Handler) {
    this.routes.push({ method, parts: path.split('/').filter(Boolean), handler });
    return this;
  }
  /** Every registered route as `METHOD /path` (tests walk the write routes to check each one is guarded or classified). */
  list(): string[] { return this.routes.map((r) => `${r.method} /${r.parts.join('/')}`); }
  get(p: string, h: Handler) { return this.on('GET', p, h); }
  post(p: string, h: Handler) { return this.on('POST', p, h); }
  put(p: string, h: Handler) { return this.on('PUT', p, h); }
  patch(p: string, h: Handler) { return this.on('PATCH', p, h); }
  delete(p: string, h: Handler) { return this.on('DELETE', p, h); }

  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null | 'method' {
    const segs = path.split('/').filter(Boolean).map(decodeURIComponent);
    let pathMatched = false;
    for (const r of this.routes) {
      const last = r.parts[r.parts.length - 1];
      const rest = last?.startsWith('*');
      if (!rest && r.parts.length !== segs.length) continue;
      if (rest && segs.length < r.parts.length) continue; // rest segment needs at least one part
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const p = r.parts[i];
        if (p.startsWith('*')) { params[p.slice(1)] = segs.slice(i).join('/'); break; }
        if (p.startsWith(':')) params[p.slice(1)] = segs[i];
        else if (p !== segs[i]) { ok = false; break; }
      }
      if (!ok) continue;
      pathMatched = true;
      if (r.method === method) return { handler: r.handler, params };
    }
    return pathMatched ? 'method' : null;
  }

  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const m = this.match(req.method ?? 'GET', url.pathname);
    if (m === null) return false;
    let bodyCache: Buffer | null = null;
    const body = async () => {
      if (bodyCache) return bodyCache;
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const c of req) {
        size += (c as Buffer).length;
        if (size > MAX_BODY) throw new HttpError(413, 'TOO_LARGE', 'request body too large');
        chunks.push(c as Buffer);
      }
      return (bodyCache = Buffer.concat(chunks));
    };
    try {
      if (m === 'method') throw new HttpError(405, 'METHOD_NOT_ALLOWED', `${req.method} not allowed on ${url.pathname}`);
      const out = await m.handler({
        method: req.method ?? 'GET', path: url.pathname, params: m.params, query: url.searchParams, headers: req.headers, body,
        json: async () => {
          const b = await body();
          if (!b.length) return {};
          try { return JSON.parse(b.toString('utf8')); } catch { throw badRequest('body is not valid JSON'); }
        },
      });
      if (out instanceof Reply) send(res, out.status, out.body, out.headers);
      else sendJson(res, req.method === 'POST' && out && typeof out === 'object' && (out as any).__created ? 201 : 200, stripMarker(out));
    } catch (err) {
      if (err instanceof HttpError) sendJson(res, err.status, { error: { code: err.code, message: err.message, details: err.details } });
      else {
        console.error(err);
        sendJson(res, 500, { error: { code: 'INTERNAL', message: 'internal error' } });
      }
    }
    return true;
  }
}

/** Mark a handler result as "created" (HTTP 201). */
export const created = <T extends object>(x: T): T => Object.assign(x, { __created: true });
const stripMarker = (x: any) => { if (x && typeof x === 'object' && '__created' in x) { const { __created, ...rest } = x; return rest; } return x; };

export function send(res: ServerResponse, status: number, body: string | Buffer, headers: Record<string, string> = {}) {
  res.writeHead(status, headers);
  res.end(body);
}
export function sendJson(res: ServerResponse, status: number, value: unknown) {
  send(res, status, JSON.stringify(value ?? null), { 'content-type': 'application/json; charset=utf-8' });
}
