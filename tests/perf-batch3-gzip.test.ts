// Perf batch 3: JSON bodies of 32 KB and more are gzipped when, and only when, the request says it accepts gzip. The bytes are the same either way; SSE is never touched.
import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'node:http';
import { gunzipSync } from 'node:zlib';
import { acceptsGzip, GZIP_MIN } from '../server/http/json-body.ts';
import { busFor } from '../server/events/bus.ts';
import { generateMock } from '../scripts/mock/generate.ts';
import { startApp, sampleManifests } from './helpers.ts';

/** A raw GET (no automatic decoding, and no Accept-Encoding unless given): status, headers and the body bytes as sent. */
function raw(base: string, path: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; headers: Record<string, any>; body: Buffer }>((resolve, reject) => {
    get(base + path, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('acceptsGzip: only when the header allows gzip', () => {
  const yes = ['gzip', 'GZIP', 'gzip, deflate', 'deflate, gzip;q=0.5', 'br, gzip', '*', 'x-gzip', '*;q=0.1', 'identity, *', 'gzip;q=1.0', ' gzip ; q=0.8 ', 'deflate;q=0, gzip'];
  const no = [undefined, '', 'identity', 'deflate', 'br', 'gzip;q=0', 'gzip;q=0.0', '*;q=0', 'gzip;q=0, *', '*, gzip;q=0', 'gzip;q=abc', 'gzipx', 'ngzip', 'deflate, br', ','];
  for (const h of yes) assert.equal(acceptsGzip(h), true, String(h));
  for (const h of no) assert.equal(acceptsGzip(h), false, String(h));
  assert.equal(acceptsGzip(['deflate', 'gzip']), true);
});

test('big JSON: gzip only on request, byte-identical after gunzip, small ones and errors never compressed', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('POST', '/api/ingest', { manifests: generateMock({ services: 40, seed: 5, env: 'big' }) })).status, 201);
    assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
    const path = '/api/envs/big/model';
    const plain = await raw(app.base, path);
    assert.equal(plain.status, 200);
    assert.ok(plain.body.length >= GZIP_MIN, `fixture is big enough (${plain.body.length} bytes)`);
    assert.equal(plain.headers['content-encoding'], undefined);
    assert.equal(plain.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(plain.headers['vary'], 'Accept-Encoding');
    assert.equal(plain.headers['content-length'], String(plain.body.length));
    const json = JSON.parse(plain.body.toString('utf8'));
    for (const h of ['gzip', 'gzip, deflate, br', '*', 'deflate, gzip;q=0.3']) {
      const z = await raw(app.base, path, { 'accept-encoding': h });
      assert.equal(z.status, 200); assert.equal(z.headers['content-encoding'], 'gzip', h);
      assert.equal(z.headers['vary'], 'Accept-Encoding');
      assert.equal(z.headers['content-length'], String(z.body.length));
      assert.ok(z.body.length < plain.body.length / 3, 'it is smaller');
      assert.deepEqual(gunzipSync(z.body), plain.body, 'the same bytes');
    }
    for (const h of ['identity', 'br', 'deflate', 'gzip;q=0', '*;q=0', 'gzip;q=abc']) {
      const r = await raw(app.base, path, { 'accept-encoding': h });
      assert.equal(r.headers['content-encoding'], undefined, h);
      assert.deepEqual(r.body, plain.body, h);
    }
    // a second request is the same bytes again (served from the kept body)
    assert.deepEqual(gunzipSync((await raw(app.base, path, { 'accept-encoding': 'gzip' })).body), plain.body);
    assert.deepEqual((await raw(app.base, path)).body, plain.body);
    // the object is what JSON.stringify gives
    assert.equal(plain.body.toString('utf8'), JSON.stringify(json));
    // other endpoints: small bodies are untouched even when gzip is accepted; so is an error
    const small = await raw(app.base, '/api/envs', { 'accept-encoding': 'gzip' });
    assert.equal(small.headers['content-encoding'], undefined); assert.equal(small.headers['vary'], undefined);
    assert.ok(Array.isArray(JSON.parse(small.body.toString('utf8'))));
    const nf = await raw(app.base, '/api/envs/prod/views/service/nope', { 'accept-encoding': 'gzip' });
    assert.equal(nf.status, 404); assert.equal(nf.headers['content-encoding'], undefined);
    assert.equal(JSON.parse(nf.body.toString('utf8')).error.code, 'NOT_FOUND');
    // memoised reports and the service page: the same answer compressed and not
    for (const p of ['/api/envs/big/views/system', '/api/envs/big/inventory', '/api/envs/big/services', `/api/envs/big/views/service/${json.services[0].name}`]) {
      const a = await raw(app.base, p), b = await raw(app.base, p, { 'accept-encoding': 'gzip' });
      assert.equal(a.status, 200, p);
      assert.deepEqual(b.headers['content-encoding'] === 'gzip' ? gunzipSync(b.body) : b.body, a.body, p);
    }
    // POST answers (created, MCP) keep their status and body
    const mcp = (h: Record<string, string>) => fetch(`${app.base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json', ...h }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }).then((r) => r.json());
    assert.deepEqual(await mcp({ 'accept-encoding': 'gzip' }), await mcp({ 'accept-encoding': 'identity' }));
  } finally { await app.close(); }
});

test('SSE /api/events: never compressed or buffered, with or without Accept-Encoding: gzip', async () => {
  const app = await startApp({ events: { heartbeatMs: 60_000 } });
  try {
    for (const enc of [undefined, 'gzip', 'gzip, deflate, br']) {
      await new Promise<void>((done, fail) => {
        const headers: Record<string, string> = { accept: 'text/event-stream' };
        if (enc) headers['accept-encoding'] = enc;
        const req = get(app.base + '/api/events', { headers }, (res) => {
          try {
            assert.equal(res.statusCode, 200);
            assert.match(String(res.headers['content-type']), /^text\/event-stream/);
            assert.equal(res.headers['content-encoding'], undefined, `no Content-Encoding (Accept-Encoding: ${enc})`);
            assert.equal(res.headers['content-length'], undefined);
          } catch (e) { req.destroy(); fail(e as Error); return; }
          let text = '', emitted = false;
          res.setEncoding('utf8');
          res.on('data', (c: string) => {
            text += c;
            try {
              if (!emitted && text.includes('retry: 3000')) { // the opening comment arrived as plain text, at once
                emitted = true;
                busFor(app.ctx.db as any).emit({ type: 'bug.created', summary: `plain line ${enc}`, data: { n: 1 } });
              }
              if (text.includes(`plain line ${enc}`)) { // the event arrived right away as a plain frame
                assert.match(text, /event: bug\.created\ndata: \{.*"summary":"plain line/);
                req.destroy(); done();
              }
            } catch (e) { req.destroy(); fail(e as Error); }
          });
        });
        req.on('error', () => {});
        setTimeout(() => { req.destroy(); fail(new Error(`no plain event within 3 s (Accept-Encoding: ${enc})`)); }, 3000).unref();
      });
    }
  } finally { await app.close(); }
});
