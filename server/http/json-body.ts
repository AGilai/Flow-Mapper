// JSON responses (perf batch 3): the body bytes are exactly JSON.stringify(value); a big one (at least GZIP_MIN bytes) is gzipped with node:zlib when,
// and only when, the request's Accept-Encoding allows it, and the serialised and gzipped bodies are kept next to the object they came from (a WeakMap on
// the value: a memoised report is the same object on every request, so a warm request neither stringifies nor compresses; a fresh object is never found
// again and is collected with its bodies). SSE and the other routes that write their own response never come through here.

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { gzip } from 'node:zlib';

export const GZIP_MIN = 32 * 1024;
interface Body { json: Buffer; gz?: Promise<Buffer>; gzBytes?: number }
const bodies = new WeakMap<object, Body>();

// Perf batch 4: the kept bodies (serialised + gzipped bytes of every memoised report) are bounded together, not just by what the GC can free: a global budget,
// env FLOW_BODY_CACHE_MB (default 64). Over it, the least recently used entries go first (they are only dropped from the cache: a response being sent keeps its own copy).
// An entry that alone exceeds the budget is sent, not kept. `lru` is in use order (Map order); its keys are the values, held weakly through `refs`.
let budget = Math.floor((Number(process.env.FLOW_BODY_CACHE_MB) > 0 ? Number(process.env.FLOW_BODY_CACHE_MB) : 64) * 1024 * 1024);
interface Kept { ref: WeakRef<object>; body: Body }
const lru = new Set<Kept>(), keptOf = new WeakMap<Body, Kept>();
const bytesOf = (b: Body) => b.json.length + (b.gzBytes ?? 0);
let kept = 0;

const forget = (k: Kept) => { if (lru.delete(k)) kept -= bytesOf(k.body); const v = k.ref.deref(); if (v && bodies.get(v) === k.body) bodies.delete(v); };
/** Drop the entries whose value was collected, then the oldest ones until the bytes fit the budget. */
function enforce(): void {
  if (kept <= budget) return;
  for (const k of [...lru]) if (!k.ref.deref()) forget(k);
  for (const k of lru) { if (kept <= budget) break; forget(k); }
}
const touch = (k: Kept) => { lru.delete(k); lru.add(k); };

/** Set the byte budget of the kept bodies (tests; the default comes from FLOW_BODY_CACHE_MB) and trim to it. */
export function setBodyCacheBudget(bytes: number): void { budget = Math.max(0, Math.floor(bytes)); enforce(); }
/** What is kept right now: entries and bytes (serialised + gzipped), and the budget. */
export const bodyCacheStats = () => { for (const k of [...lru]) if (!k.ref.deref()) forget(k); return { entries: lru.size, bytes: kept, budget }; };

/** Does `Accept-Encoding` allow gzip? A listed `gzip` / `x-gzip` with q > 0, or `*` with q > 0 when gzip is not listed; anything unparseable or q=0 is no. */
export function acceptsGzip(header: IncomingHttpHeaders['accept-encoding']): boolean {
  const v = Array.isArray(header) ? header.join(',') : header;
  if (!v) return false;
  let gz: number | null = null, star: number | null = null;
  for (const part of v.split(',')) {
    const [tok, ...params] = part.trim().toLowerCase().split(';');
    const name = tok.trim();
    if (!name) continue;
    let q = 1;
    for (const p of params) if (/^\s*q\s*=/.test(p)) { const m = /^\s*q\s*=\s*(\d+(?:\.\d*)?|\.\d+)\s*$/.exec(p); q = m ? Number(m[1]) : NaN; }
    if (name === 'gzip' || name === 'x-gzip') gz = q; else if (name === '*') star = q;
  }
  return gz !== null ? gz > 0 : star !== null && star > 0;
}

const compress = (b: Buffer) => new Promise<Buffer>((ok, fail) => gzip(b, { level: 6 }, (e, out) => (e ? fail(e) : ok(out)))); // off the event loop (the thread pool)

/** Send `value` as JSON. Small bodies go as before; big ones carry `Vary: Accept-Encoding`, a Content-Length, and gzip when the client accepts it. */
export async function sendJsonFor(req: Pick<IncomingMessage, 'headers'>, res: ServerResponse, status: number, value: unknown): Promise<void> {
  const type = 'application/json; charset=utf-8';
  const hit = value !== null && typeof value === 'object' ? bodies.get(value) : undefined;
  let body = hit;
  if (hit) { const k = keptOf.get(hit); if (k) touch(k); }
  if (!body) {
    const text = JSON.stringify(value ?? null);
    if (text.length < GZIP_MIN) { res.writeHead(status, { 'content-type': type }); res.end(text); return; } // the length in characters never exceeds the bytes
    const json = Buffer.from(text);
    body = { json };
    if (value !== null && typeof value === 'object' && json.length <= budget) {
      bodies.set(value, body);
      const k: Kept = { ref: new WeakRef(value), body };
      keptOf.set(body, k); lru.add(k); kept += json.length;
      enforce();
    }
  }
  const mine = body, k = keptOf.get(mine);
  if (acceptsGzip(req.headers['accept-encoding'])) {
    const gz = await (body.gz ??= compress(body.json).then((out) => { // the gzipped copy counts toward the budget once it exists (if the entry is still kept)
      if (k && lru.has(k) && mine.gzBytes === undefined) { mine.gzBytes = out.length; kept += out.length; enforce(); }
      return out;
    }, (e) => { body!.gz = undefined; throw e; }));
    res.writeHead(status, { 'content-type': type, 'content-encoding': 'gzip', vary: 'Accept-Encoding', 'content-length': String(gz.length) });
    res.end(gz);
  } else {
    res.writeHead(status, { 'content-type': type, vary: 'Accept-Encoding', 'content-length': String(body.json.length) });
    res.end(body.json);
  }
}
