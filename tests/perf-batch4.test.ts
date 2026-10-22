// Perf batch 4: (1) the Flows list's decision counts come from `viewCounts` / a counts-only trace and equal what full views give;
// (2) the kept JSON/gzip bodies are bounded together by a byte budget (FLOW_BODY_CACHE_MB), least recently used out first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { buildIndex } from '../core/graph-index.ts';
import { entryPoints, trace } from '../core/trace.ts';
import { viewCounts, viewOf } from '../core/trace-view.ts';
import { flowDecisions } from '../core/flow-decisions.ts';
import { bodyCacheStats, sendJsonFor, setBodyCacheBudget } from '../server/http/json-body.ts';
import { sampleModel } from './helpers.ts';

const VIEWS = [{}, { choose: { '*': 'both' } }, { detail: 'full' as const }, { detail: 'full' as const, choose: { '*': 'both' } }, { group: false }, { open: ['api-gateway'] }];

test('viewCounts equals the counts and the decision count of viewOf, on every flow of the samples', () => {
  let withDecisions = 0;
  for (const model of [sampleModel()]) {
    const g = buildIndex(model);
    for (const e of entryPoints(g)) {
      const t = trace(g, { service: e.service, ingress: e.id }, { scope: 'full', maxMessages: 800 });
      const lite = trace(g, { service: e.service, ingress: e.id }, { scope: 'full', maxMessages: 800, countsOnly: true });
      assert.equal(!!t?.decisions?.length, !!lite?.decisions?.length);
      if (!t?.decisions?.length) continue;
      withDecisions++;
      for (const v of VIEWS) {
        const full = viewOf(t, v), c = viewCounts(lite!, v);
        assert.deepEqual(c.messages, full.counts?.messages ?? { min: 0, max: 0 }, `${e.service}/${e.id} ${JSON.stringify(v)}`);
        assert.equal(c.decisions, full.decisions?.length ?? 0);
      }
    }
  }
  assert.ok(withDecisions >= 1, 'the samples have flows with decisions');
});

test('flowDecisions on the samples still equals the numbers of three full views per flow', () => {
  const g = buildIndex(sampleModel());
  const got = flowDecisions(g);
  for (const e of entryPoints(g)) {
    const t = trace(g, { service: e.service, ingress: e.id }, { scope: 'full', maxMessages: 800 });
    const d = got.get(`${e.service}:${e.id}`);
    if (!t?.decisions?.length) { assert.equal(d, undefined); continue; }
    const both = viewOf(t, { choose: { '*': 'both' } }), first = viewOf(t, {}), full = viewOf(t, { detail: 'full' });
    assert.deepEqual(d, { decisions: both.decisions?.length ?? 0, steps: first.counts?.messages.min ?? 0, both: both.counts?.messages ?? { min: 0, max: 0 }, full: full.counts?.messages.min ?? 0 });
  }
});

// ---- body cache budget
const fake = () => {
  const out: { status?: number; headers?: any; body?: Buffer | string } = {};
  const res: any = { writeHead: (s: number, h: any) => { out.status = s; out.headers = h; }, end: (b: any) => { out.body = b; } };
  return { res, out };
};
const big = (tag: string, kb = 40) => ({ tag, pad: Array.from({ length: kb * 60 }, (_, i) => `${tag}-row-${i}-${(i * 7919) % 1000}`) });
const send = async (v: object, gz = false) => { const { res, out } = fake(); await sendJsonFor({ headers: gz ? { 'accept-encoding': 'gzip' } : {} } as any, res, 200, v); return out; };

test('body cache: bytes stay under the budget, least recently used go first, output is unchanged', async () => {
  setBodyCacheBudget(64 * 1024 * 1024);
  const one = big('a'), size = Buffer.byteLength(JSON.stringify(one));
  assert.ok(size > 32 * 1024);
  setBodyCacheBudget(size * 3.5); // room for three plain bodies
  const keep: object[] = [big('a'), big('b'), big('c'), big('d')];
  for (const v of keep.slice(0, 3)) await send(v);
  const s3 = bodyCacheStats();
  assert.equal(s3.entries, 3); assert.ok(s3.bytes <= s3.budget);
  await send(keep[0]); // a is now the most recently used; b is the oldest
  await send(keep[3]);
  const s4 = bodyCacheStats();
  assert.equal(s4.entries, 3, 'b went out'); assert.ok(s4.bytes <= s4.budget);
  // the answers are the same whether kept or not
  for (const v of keep) assert.equal((await send(v)).body!.toString(), JSON.stringify(v));
  assert.ok(bodyCacheStats().bytes <= s4.budget);
  // a gzipped copy counts too: it can push the oldest out, and the bytes still fit
  setBodyCacheBudget(size * 2.2);
  for (const v of keep) { const o = await send(v, true); assert.equal(gunzipSync(o.body as Buffer).toString(), JSON.stringify(v)); assert.ok(bodyCacheStats().bytes <= size * 2.2); }
  assert.ok(bodyCacheStats().entries <= 2);
  // a body bigger than the whole budget is sent and not kept
  setBodyCacheBudget(size / 2);
  assert.equal(bodyCacheStats().entries, 0);
  assert.equal((await send(keep[0])).body!.toString(), JSON.stringify(keep[0]));
  assert.equal(bodyCacheStats().entries, 0);
  setBodyCacheBudget(64 * 1024 * 1024);
});

test('body cache: a kept body is served again without a new serialisation', async () => {
  setBodyCacheBudget(64 * 1024 * 1024);
  const v = big('z');
  const a = await send(v), b = await send(v);
  assert.equal(a.body, b.body, 'the same Buffer object: it came from the cache');
  let n = 0; (v as any).toJSON = () => { n++; return { tag: 'z' }; };
  await send(v);
  assert.equal(n, 0, 'no stringify on a hit');
});
