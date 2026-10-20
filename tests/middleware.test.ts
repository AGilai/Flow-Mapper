// 0.12.0 (#31): ingress.middleware, an ordered chain of functions traced before the handler.
// Contract (schema + integrity), trace order and tags, edges, MCP, the lane segments and the fold/span helpers.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, readSample, sampleModel } from './helpers.ts';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
// @ts-ignore plain JS modules shared with the browser
import { mwSegments, segmentOf, mwSpans, mwLabel, isLongChain } from '../web/js/views/flow-mw.js';
// @ts-ignore
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { insideBar } from '../web/js/views/flow-inside.js';

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); await app.call('POST', '/api/ingest', { manifests: ['reports-api.json', 'auth-svc.json'].map(readSample) }); });
after(() => app.close());

const g = buildIndex(sampleModel());
const run = (scope: 'full' | 'intra' = 'full') => trace(g, { service: 'reports-api', ingress: 'in.getReport' }, { scope })!;

test('contract: an unknown middleware id is rejected like a bad handler; the schema wants strings', async () => {
  const bad = readSample('reports-api.json');
  bad.version = 2;
  bad.ingress[0].middleware = ['authenticate', 'NoSuchMw'];
  const r = await app.call('POST', '/api/ingest', bad);
  assert.equal(r.status, 422);
  assert.match(JSON.stringify(r.body.error.details), /middleware 'NoSuchMw'/);
  const typed = readSample('reports-api.json');
  typed.version = 3;
  typed.ingress[0].middleware = [3];
  assert.equal((await app.call('POST', '/api/ingest', typed)).status, 422);
});

test('details.middleware is still accepted and not traced', () => {
  const m = sampleModel();
  const i = m.ingress.find((x: any) => x.service === 'reports-api');
  delete i.middleware;
  i.details = { ...i.details, middleware: ['authenticate', 'rateLimit'] };
  const t = trace(buildIndex(m), { service: 'reports-api', ingress: 'in.getReport' })!;
  assert.ok(!t.messages.some((x) => x.middleware || x.middlewareChain));
  assert.ok(!t.messages.some((x) => x.egress === 'auth.verify'));
});

test('trace: middleware run in order before the handler, as ordinary visits, and are tagged', () => {
  const t = run();
  const own = t.messages.filter((m) => m.service === 'reports-api');
  assert.deepEqual(own.map((m) => `${m.fn}:${m.kind}`), ['getReport:entry', 'authenticate:call', 'authenticate:egress', 'rateLimit:resource', 'getReport:resource']);
  const entry = t.messages[0];
  assert.deepEqual(entry.middlewareChain, [{ fn: 'authenticate', name: 'authenticate' }, { fn: 'rateLimit', name: 'rateLimit' }]);
  const auth = t.messages.find((m) => m.egress === 'auth.verify')!;
  assert.deepEqual(auth.middleware, { fn: 'authenticate', index: 0 });
  assert.equal(auth.depth, t.messages.find((m) => m.fn === 'getReport' && m.kind === 'resource')!.depth, 'drawn from the same bar as the handler\'s calls');
  assert.deepEqual(t.messages.find((m) => m.fn === 'rateLimit')!.middleware, { fn: 'rateLimit', index: 1 });
  assert.equal(t.messages.find((m) => m.fn === 'getReport' && m.kind === 'resource')!.middleware, undefined);
  // the callee's own work is not middleware
  assert.equal(t.messages.find((m) => m.service === 'auth-svc' && m.kind === 'resource')!.middleware, undefined);
  // ordered: every tagged message comes before the first handler message
  const firstHandler = t.messages.findIndex((m) => m.fn === 'getReport' && m.kind === 'resource');
  assert.ok(t.messages.slice(0, firstHandler).filter((m) => m.middleware).length >= 3);
  assert.ok(!t.messages.slice(firstHandler).some((m) => m.middleware));
});

test('trace without middleware is unchanged: no tag, no chain', () => {
  for (const [service, ingress] of [['api-gateway', 'in.createOrder'], ['orders-svc', 'in.create']]) {
    const t = trace(g, { service, ingress })!;
    assert.ok(t.messages.every((m) => !('middleware' in m) && !('middlewareChain' in m)));
  }
});

test('scope=intra: the middleware calls are the service\'s own outgoing calls; the callee is not expanded', () => {
  const t = run('intra');
  const auth = t.messages.find((m) => m.egress === 'auth.verify')!;
  assert.ok(auth.middleware && auth.to === 'svc:auth-svc');
  assert.ok(!t.messages.some((m) => m.service === 'auth-svc'));
});

test('the middleware call is a real edge on the system map, in the service view and in flow counts', async () => {
  const sys = (await app.call('GET', '/api/envs/prod/views/system')).body;
  assert.ok(sys.edges.some((e: any) => e.from === 'svc:reports-api' && e.to === 'svc:auth-svc'), JSON.stringify(sys.edges.filter((e: any) => JSON.stringify(e).includes('reports-api'))));
  const v = (await app.call('GET', '/api/envs/prod/views/service/reports-api')).body;
  assert.deepEqual(v.ingress[0].middleware, ['authenticate', 'rateLimit']);
  assert.equal(v.egress.find((e: any) => e.id === 'auth.verify').targets.length, 1);
  const c = (await app.call('GET', '/api/envs/prod/flows/counts')).body.find((x: any) => x.service === 'reports-api');
  assert.ok(c.services >= 1, 'auth-svc is reached through the middleware');
  const eps = (await app.call('GET', '/api/envs/prod/entry-points')).body;
  assert.deepEqual(eps.find((e: any) => e.service === 'reports-api').middleware, ['authenticate', 'rateLimit']);
  assert.ok(eps.filter((e: any) => e.service !== 'reports-api').every((e: any) => !('middleware' in e)));
});

test('API and MCP trace_flow include the middleware', async () => {
  const api = (await app.call('GET', '/api/envs/prod/trace?service=reports-api&ingress=in.getReport')).body;
  assert.ok(api.messages.some((m: any) => m.middleware?.fn === 'authenticate'));
  const res = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trace_flow', arguments: { env: 'prod', service: 'reports-api', ingress: 'in.getReport' } } });
  const out = JSON.parse(res.body.result.content[0].text);
  assert.ok(out.messages.some((m: any) => m.middleware?.fn === 'authenticate' && m.egress === 'auth.verify'));
  assert.equal(out.messages[0].middlewareChain.length, 2);
});

test('fold: a chain of up to 3 is one segment each; longer is one "middleware (N)" segment until expanded', () => {
  const chain = (n: number) => Array.from({ length: n }, (_, i) => ({ fn: `m${i}`, name: `mw${i}` }));
  assert.deepEqual(mwSegments(chain(2)).map((s: any) => s.label), ['mw0', 'mw1']);
  assert.equal(mwSegments(chain(3)).length, 3);
  const folded = mwSegments(chain(5));
  assert.equal(folded.length, 1);
  assert.equal(folded[0].label, 'middleware (5)');
  assert.deepEqual(folded[0].indexes, [0, 1, 2, 3, 4]);
  assert.equal(segmentOf(folded, 4), 0);
  assert.equal(mwSegments(chain(5), true).length, 5);
  assert.equal(mwSegments(chain(5), true)[0].collapse, true);
  assert.deepEqual(mwSegments([]), []);
  assert.ok(isLongChain(chain(4)) && !isLongChain(chain(3)));
  assert.equal(mwLabel(folded[0], 2), 'middleware (5) · 2 internal ▸');
});

test('spans: each segment runs from its label row to the row before the next; the last ends at the handler part', () => {
  assert.deepEqual(mwSpans([1, 4, 5], 7), [{ from: 1, to: 3 }, { from: 4, to: 4 }, { from: 5, to: 7 }]);
  assert.deepEqual(mwSpans([2], 2), [{ from: 2, to: 2 }]);
  assert.deepEqual(mwSpans([], 3), []);
});

test('lane: the segments sit on the first bar, before the handler rows, and the calls hang off the bar', () => {
  const t = run();
  const lane = buildLane(t.messages, { scope: t.scope, participants: t.participants });
  const bar = lane.bars[0];
  assert.equal(bar.service, 'reports-api');
  assert.equal(bar.mw.spans.length, 2);
  const rows = lane.events.map((e: any) => e.type);
  const labels = lane.events.filter((e: any) => e.type === 'mw');
  assert.deepEqual(labels.map((e: any) => e.seg.label), ['authenticate', 'rateLimit']);
  assert.equal(labels[0].row, bar.start + 1, 'the first segment starts right under the call, where the bar starts');
  assert.equal(labels[0].internal, 1, 'readBearer is folded into the segment');
  // the auth call is drawn from the bar inside the first segment; the handler's store row comes after the last segment
  const authRow = lane.events.findIndex((e: any) => e.msg?.egress === 'auth.verify');
  assert.ok(authRow > bar.mw.spans[0].from && authRow <= bar.mw.spans[0].to);
  const handlerRow = lane.events.findIndex((e: any) => e.type === 'store' && e.msg.fn === 'getReport');
  assert.ok(handlerRow > bar.mw.spans[1].to);
  assert.ok(rows.indexOf('mw') < rows.indexOf('store'));
  assert.equal(bar.mw.spans[1].from, labels[1].row);
});

test('lane: a long chain folds into one segment, expands on request; a middleware with no calls still gets a segment', () => {
  const t = run();
  const chain = Array.from({ length: 5 }, (_, i) => ({ fn: `m${i}`, name: `m${i}` }));
  const entry = { ...t.messages[0], middlewareChain: chain };
  const msgs = [entry, ...t.messages.slice(1).map((m: any) => (m.middleware ? { ...m, middleware: { fn: 'm3', index: 3 } } : m))];
  const folded = buildLane(msgs, { scope: 'full', participants: t.participants });
  assert.deepEqual(folded.events.filter((e: any) => e.type === 'mw').map((e: any) => e.seg.label), ['middleware (5)']);
  const open = buildLane(msgs, { scope: 'full', participants: t.participants, mwOpen: true });
  assert.deepEqual(open.events.filter((e: any) => e.type === 'mw').map((e: any) => e.seg.label), ['m0', 'm1', 'm2', 'm3', 'm4']);
  assert.equal(open.bars[0].mw.spans.length, 5);
  assert.ok(open.bars[0].mw.spans.every((s: any) => s.to >= s.from));
});

test('lane: an ingress without middleware draws no segment', () => {
  const t = trace(g, { service: 'api-gateway', ingress: 'in.createOrder' })!;
  const lane = buildLane(t.messages, { scope: t.scope, participants: t.participants });
  assert.ok(lane.bars.every((b: any) => !b.mw) && !lane.events.some((e: any) => e.type === 'mw'));
});

test('drill-down: the middleware chain is listed first, in order, then the handler', () => {
  const t = run();
  const lane = buildLane(t.messages, { scope: t.scope, participants: t.participants });
  const info = insideBar(lane.bars[0], t);
  assert.equal(info.middleware, 2);
  assert.deepEqual(info.functions.map((f: any) => f.fn), ['authenticate', 'readBearer', 'rateLimit', 'getReport']);
  assert.deepEqual(info.functions.map((f: any) => f.middleware), [1, null, 2, null]);
  assert.equal(info.functions[3].isEntry, true);
});
