// JSON responses (perf batch 3): the body bytes are exactly JSON.stringify(value); a big one (at least GZIP_MIN bytes) is gzipped with node:zlib when,
// and only when, the request's Accept-Encoding allows it, and the serialised and gzipped bodies are kept next to the object they came from (a WeakMap on
// the value: a memoised report is the same object on every request, so a warm request neither stringifies nor compresses; a fresh object is never found
// again and is collected with its bodies). SSE and the other routes that write their own response never come through here.

import type { IncomingHttpHeaders, IncomingMessage, ServerResponse } from 'node:http';
import { gzip } from 'node:zlib';

export const GZIP_MIN = 32 * 1024;
const CACHE_MAX = 96 * 1024 * 1024; // bigger bodies are sent, not kept
interface Body { json: Buffer; gz?: Promise<Buffer> }
const bodies = new WeakMap<object, Body>();

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
  if (!body) {
    const text = JSON.stringify(value ?? null);
    if (text.length < GZIP_MIN) { res.writeHead(status, { 'content-type': type }); res.end(text); return; } // the length in characters never exceeds the bytes
    const json = Buffer.from(text);
    body = { json };
    if (value !== null && typeof value === 'object' && json.length <= CACHE_MAX) bodies.set(value, body);
  }
  if (acceptsGzip(req.headers['accept-encoding'])) {
    const gz = await (body.gz ??= compress(body.json).catch((e) => { body!.gz = undefined; throw e; }));
    res.writeHead(status, { 'content-type': type, 'content-encoding': 'gzip', vary: 'Accept-Encoding', 'content-length': String(gz.length) });
    res.end(gz);
  } else {
    res.writeHead(status, { 'content-type': type, vary: 'Accept-Encoding', 'content-length': String(body.json.length) });
    res.end(body.json);
  }
}
