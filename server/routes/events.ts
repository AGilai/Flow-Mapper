// Push event stream: GET /api/events (Server-Sent Events) and GET /api/events/recent (plain JSON). See docs/API.md.

import type { Router } from '../http/router.ts';
import { STREAMED } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { HttpError, badRequest } from '../errors.ts';
import { roleFor, isOff } from '../access.ts';
import { busFor, matches, parseFilter, type PushEvent } from '../events/bus.ts';

export interface StreamOptions { heartbeatMs?: number; maxClients?: number }

const frame = (e: PushEvent) => `id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`;

export function registerEvents(r: Router, ctx: Ctx, opts: StreamOptions = {}) {
  const bus = busFor(ctx.db);
  const heartbeatMs = opts.heartbeatMs ?? 25_000, maxClients = opts.maxClients ?? 32;
  let clients = 0;

  const sinceOf = (header: unknown, query: string | null): number | null => {
    const raw = typeof header === 'string' && header !== '' ? header : query;
    if (raw === null || raw === '') return null;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw badRequest('since / Last-Event-ID must be a non-negative integer event id');
    return n;
  };

  // accounts: an event about an environment the caller cannot read is never sent (checked per event: sharing changes while a stream is open)
  const seeable = (db: Ctx['db'], who: import('../auth/context.ts').Principal | undefined) => (e: PushEvent) => isOff(who) || e.env === undefined || roleFor(db, e.env, who) !== 'none';

  r.get('/api/events', (req) => {
    const filter = parseFilter(req.query), see = seeable(ctx.db, req.who);
    const since = sinceOf(req.headers['last-event-id'], req.query.get('since'));
    if (clients >= maxClients) throw new HttpError(503, 'TOO_MANY_CLIENTS', `at most ${maxClients} event streams at once`);
    const { req: rq, res } = req.raw;
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache, no-transform', connection: 'keep-alive', 'x-accel-buffering': 'no' });
    clients++;
    res.write(`retry: 3000\n: connected, last id ${bus.lastId()}\n\n`);
    let done = false, off = () => {}, beat: NodeJS.Timeout | undefined;
    const stop = () => { if (done) return; done = true; clients--; off(); clearInterval(beat); res.end(); };
    const send = (e: PushEvent) => { if (res.writableLength > 1 << 20) return stop(); res.write(frame(e)); };
    // Replay and subscribe in the same tick: no event can slip between them.
    if (since !== null) for (const e of bus.since(since, filter)) if (see(e)) send(e);
    if (done) return STREAMED;
    off = bus.subscribe((e) => { if (!done && matches(e, filter) && see(e)) send(e); });
    beat = setInterval(() => res.write(': heartbeat\n\n'), heartbeatMs);
    beat.unref();
    rq.on('close', stop);
    res.on('error', stop);
    return STREAMED;
  });

  r.get('/api/events/recent', (req) => {
    const filter = parseFilter(req.query), see = seeable(ctx.db, req.who);
    const since = sinceOf(undefined, req.query.get('since'));
    const limit = Math.min(Number(req.query.get('limit')) || 100, 1000);
    const events = (since === null ? bus.latest(limit, filter) : bus.since(since, filter, limit)).filter(see);
    return { events, lastId: bus.lastId() };
  });
}
