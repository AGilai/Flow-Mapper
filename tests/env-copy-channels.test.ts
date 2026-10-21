// A Components copy is self-contained: it brings the channels the picked services use and the bindings between copied
// items, under one synthetic infra owner "<source>-infra", and nothing else of the services that declared them.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, startApp } from './helpers.ts';
import { downstreamIngress } from '../core/graph-index.ts';

let app: Awaited<ReturnType<typeof startApp>>;
const q = (sql: string, ...a: any[]) => app.ctx.db.prepare(sql).all(...a) as any[];
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

test('cp-middleware alone brings its exchange and the bindings between copied items, not the rest of the infra service', async () => {
  const r = await app.call('POST', '/api/envs', { name: 'cp-only', source: 'prod', mode: 'components', services: [{ name: 'cp-middleware' }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const svcs = (await app.call('GET', '/api/envs/cp-only/services')).body;
  assert.deepEqual(svcs.map((s: any) => [s.name, s.kind]).sort(), [['cp-middleware', 'service'], ['prod-infra', 'infra']]);
  assert.equal(svcs.find((s: any) => s.name === 'prod-infra').groupPath, 'infra', 'a Components copy puts it in subsystem infra (0.28.3, #64)');

  const chans = q("SELECT key FROM entities WHERE env = 'cp-only' AND service = 'prod-infra' AND list = 'channels'").map((e) => e.key);
  assert.ok(chans.includes('amqp:saferx.EventExchange'), 'the exchange cp-middleware publishes to');
  const all = q("SELECT count(*) AS n FROM entities WHERE env = 'prod' AND list = 'channels'")[0].n;
  assert.ok(chans.length >= 1 && chans.length < all / 3, `only what cp-middleware uses (${chans.length} of ${all})`);
  assert.equal(chans.some((k) => k.startsWith('sns:')), false, 'nothing of account-infra comes along');
  assert.equal(q("SELECT count(*) AS n FROM entities WHERE env = 'cp-only' AND list IN ('functions', 'ingress', 'egress', 'resources') AND service = 'prod-infra'")[0].n, 0);

  // every copied binding connects two copied things
  const keys = new Set(q("SELECT key FROM entities WHERE env = 'cp-only' AND list = 'channels'").map((e) => e.key));
  const ingress = new Set(q("SELECT data FROM entities WHERE env = 'cp-only' AND list = 'ingress'").map((e) => JSON.parse(e.data).bindKey));
  for (const e of q("SELECT data FROM entities WHERE env = 'cp-only' AND list = 'bindings'")) {
    const b = JSON.parse(e.data);
    assert.ok(keys.has(b.to) || ingress.has(b.to), `binding ${b.id} to ${b.to}`);
  }
  // they are in the baseline, so they diff as unchanged
  assert.equal(q("SELECT count(*) AS n FROM baseline_items WHERE env = 'cp-only' AND service = 'prod-infra' AND list = 'channels'")[0].n, chans.length);
  assert.equal(q("SELECT count(*) AS n FROM baseline_items WHERE env = 'cp-only' AND service = 'prod-infra' AND list = 'header'")[0].n, 1);
  // the "comes along" count matches what was copied
  const carry = (await app.call('GET', '/api/envs/prod/components')).body.find((x: any) => x.name === 'cp-middleware').counts.channels;
  assert.equal(carry, keys.size);
  // Its async calls still reach their channels. A call counts as dangling only when it reaches an ingress, and the ingress of
  // a consumer or an RPC server that was not picked is not in the copy: every such call must be one of those, none may be new for another reason.
  const [prod, copy] = [app.ctx.graph('prod'), app.ctx.graph('cp-only')];
  const toChannel = (g: typeof prod) => new Set(g.resolution.links.filter((l) => l.from.type === 'egress' && l.from.service === 'cp-middleware' && l.to.type === 'channel').map((l) => (l.from as any).id + '>' + (l.to as any).key));
  assert.deepEqual([...toChannel(copy)].sort(), [...toChannel(prod)].sort(), 'every publish still reaches its exchange or queue');
  const inProd = new Set(prod.resolution.dangling.map((e) => e.service + ':' + e.id));
  for (const e of copy.resolution.dangling.filter((d) => d.service === 'cp-middleware')) {
    if (inProd.has(`${e.service}:${e.id}`)) continue;
    const far = downstreamIngress(prod, { type: 'egress', service: e.service, id: e.id }).map((d) => d.ingress.service);
    assert.ok(far.length > 0 && far.every((s) => s !== 'cp-middleware'), `${e.id} is new in the copy only because its far side (${far.join(', ')}) is not copied`);
  }
  assert.ok(app.ctx.graph('cp-only').resolution.unbound.length > 0, 'the queues that lead to unpicked consumers show as "no consumer", a visible gap in the design');
});

test('a service that declares its own channels brings them once; a second pick of the same exchange is not duplicated', async () => {
  const r = await app.call('POST', '/api/envs', { name: 'two-pick', source: 'prod', mode: 'components', services: [{ name: 'cp-middleware' }, { name: 'swg-api' }] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const dup = q("SELECT key, count(*) AS n FROM entities WHERE env = 'two-pick' AND list = 'channels' GROUP BY key HAVING n > 1");
  assert.deepEqual(dup, []);
});
