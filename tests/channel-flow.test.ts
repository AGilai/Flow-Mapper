// The channel flow: merged subscription rows, the delivery grid and the summary, on a small
// hand-built model (pure core) and on the sample system through the API.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { channelFlow } from '../core/channel-flow.ts';
import { filterLabel } from '../core/glob.ts';
import type { Model } from '../core/types.ts';
import { sampleManifests, startApp } from './helpers.ts';

const model = (over: Partial<Model> = {}): Model => ({
  env: 't',
  services: ['pub', 'infra', 'sub'].map((name) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' }) as any),
  functions: [],
  ingress: [{ service: 'sub', id: 'in', bindKey: 'sqs:q', transport: 'sqs', handler: 'h', events: [{ type: 'A', handler: 'onA' }] }],
  egress: [{ service: 'pub', id: 'out', bindKey: 'sns:t', transport: 'sns', events: ['A', 'B'] }],
  resources: [],
  channels: [
    { service: 'infra', bindKey: 'sns:t', kind: 'sns-topic' },
    { service: 'infra', bindKey: 'sqs:q', kind: 'sqs-queue' },
  ],
  bindings: [{ service: 'infra', id: 's1', from: 'sns:t', to: 'sqs:q', events: ['A'] }],
  ...over,
});
const flow = (m: Model, key: string) => channelFlow(buildIndex(m), key);
const cells = (f: ReturnType<typeof flow>) => Object.fromEntries(f.grid.rows.map((r) => [r.type, r.cells[0]]));

test('filter labels: exclusions read as "all except"', () => {
  assert.equal(filterLabel('*'), 'all events');
  assert.equal(filterLabel(['A']), 'A only');
  assert.equal(filterLabel(['!A', '!B']), 'all except A, B');
  assert.equal(filterLabel(['A*', '!AB']), 'A* except AB');
});

test('a topic: handled, filtered out and unhandled events each get their own cell', () => {
  const f = flow(model({ bindings: [{ service: 'infra', id: 's1', from: 'sns:t', to: 'sqs:q', events: ['A', 'B'] }] }), 'sns:t');
  assert.equal(f.layout, 'fanout');
  assert.equal(f.rows.length, 1);
  const c = cells(f);
  assert.deepEqual([c.A.status, c.A.handler], ['handled', 'onA']);
  assert.deepEqual([c.B.status, c.B.uncertain], ['no-handler', false]);
  const filtered = cells(flow(model(), 'sns:t'));
  assert.equal(filtered.B.status, 'filtered');
  assert.match(filtered.B.why, /A only/);
});

test('exclusion filters pass everything else', () => {
  const c = cells(flow(model({ bindings: [{ service: 'infra', id: 's1', from: 'sns:t', to: 'sqs:q', events: ['!B'] }] }), 'sns:t'));
  assert.equal(c.A.status, 'handled');
  assert.equal(c.B.status, 'filtered');
});

test('two manifests declaring one subscription merge into one row, with the disagreement named', () => {
  const m = model({ bindings: [
    { service: 'infra', id: 's1', from: 'sns:t', to: 'sqs:q', events: ['A'], provenance: { verified: 'drift' } },
    { service: 'sub', id: 's2', from: 'sns:t', to: 'sqs:q', events: '*' },
  ] });
  const f = flow(m, 'sns:t');
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].filter!.agree, false);
  assert.equal(f.rows[0].filter!.differs, 'filter');
  assert.deepEqual(f.rows[0].filter!.declarations.map((d) => [d.service, d.verified]), [['infra', 'drift'], ['sub', null]]);
  const b = cells(f).B;
  assert.deepEqual([b.status, b.uncertain], ['no-handler', true]);
  assert.match(b.why, /if sub's “all events” is right\. With infra's “A only” it is not delivered/);
  assert.equal(cells(f).A.uncertain, false); // both claims let A through
  assert.equal(f.summary.callouts[0].rowId, f.rows[0].id);
  assert.match(f.summary.callouts[0].text, /infra and sub disagree on the filter, so B may reach sub, which has no handler for it/);
});

test('declarations that agree stay one row and are not flagged', () => {
  const m = model({ bindings: [
    { service: 'infra', id: 's1', from: 'sns:t', to: 'sqs:q', events: ['A'] },
    { service: 'sub', id: 's2', from: 'sns:t', to: 'sqs:q', events: ['A'] },
  ] });
  const f = flow(m, 'sns:t');
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].filter!.agree, true);
  assert.equal(f.rows[0].filter!.declarations.length, 2);
});

test('a queue lists each upstream topic once and reuses the same cells', () => {
  const m = model({ bindings: [
    { service: 'infra', id: 's1', from: 'sns:t', to: 'sqs:q', events: '*' },
    { service: 'sub', id: 's2', from: 'sns:t', to: 'sqs:q', events: '*' },
  ] });
  const f = flow(m, 'sqs:q');
  assert.equal(f.layout, 'inbound');
  assert.equal(f.rows.length, 1);
  assert.equal(f.rows[0].from!.key, 'sns:t');
  assert.deepEqual(f.grid.rows.map((r) => [r.type, r.cells[0].status]), [['A', 'handled'], ['B', 'no-handler']]);
  assert.equal(f.summary.text, 'Fed by sns:t, read by sub.');
});

test('a topic nobody subscribes to explains itself, and a queue nobody reads gets a column that says so', () => {
  const none = flow(model({ bindings: [] }), 'sns:t');
  assert.equal(none.rows.length, 0);
  assert.equal(none.summary.text, 'pub publishes 2 event types here.');
  const unread = flow(model({ ingress: [] }), 'sns:t');
  assert.equal(unread.grid.rows[0].cells[0].status, 'no-consumer');
  assert.match(unread.summary.text, /no harvested reader yet/);
});

test('candidate event types show as possible and are not counted as problems', () => {
  const m = model({
    egress: [{ service: 'pub', id: 'out', bindKey: 'sns:t', transport: 'sns', events: ['A'], unresolved: [{ what: 'event', reason: 'dynamic', candidates: ['B', 'C'] }] }],
    bindings: [{ service: 'infra', id: 's1', from: 'sns:t', to: 'sqs:q', events: '*' }],
  });
  const f = flow(m, 'sns:t');
  const row = (t: string) => f.grid.rows.find((r) => r.type === t)!;
  assert.equal(row('A').possible, undefined);
  assert.equal(row('B').possible, true);
  assert.equal(row('B').cells[0].possible, true);
  assert.equal(row('B').cells[0].status, 'no-handler'); // the consumer lists A only
  assert.equal(f.summary.text, 'pub publishes 1 event type here, and possibly 2 more; the topic fans out to 1 queue, read by 1 service.');
  assert.equal(f.summary.callouts.length, 0);
  assert.equal(flow(m, 'sqs:q').grid.rows.length, 3);
});

test('a topic that forwards to another topic resolves the consumers through the chain, with its filters', () => {
  const m = model({
    channels: [{ service: 'infra', bindKey: 'sns:t', kind: 'sns-topic' }, { service: 'infra', bindKey: 'sns:t2', kind: 'sns-topic' }, { service: 'infra', bindKey: 'sqs:q', kind: 'sqs-queue' }],
    bindings: [
      { service: 'infra', id: 'a', from: 'sns:t', to: 'sns:t2', events: '*' },
      { service: 'infra', id: 'b', from: 'sns:t2', to: 'sqs:q', events: ['A'] },
    ],
    ingress: [{ service: 'sub', id: 'in', bindKey: 'sqs:q', transport: 'sqs', handler: 'h', events: [{ type: 'A', handler: 'onA' }, { type: 'B', handler: 'onB' }] }],
  });
  const f = flow(m, 'sns:t');
  assert.equal(f.rows.length, 1);
  assert.deepEqual(f.rows[0].consumers.map((c) => c.service), ['sub']);
  assert.deepEqual([cells(f).A.status, cells(f).A.handler], ['handled', 'onA']);
  assert.equal(cells(f).B.status, 'filtered'); // the second hop only lets A through
  assert.match(cells(f).B.why, /further down/);
  assert.deepEqual(flow(m, 'sqs:q').grid.rows.map((r) => [r.type, r.cells[0].status]), [['A', 'handled'], ['B', 'filtered']]);
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

test('the channel API returns the flow for the sample topic and queue', async () => {
  const t = (await app.call('GET', `/api/envs/prod/channels/${encodeURIComponent('sns:order-events')}`)).body;
  assert.equal(t.definedBy, 'infra');
  assert.equal(t.flow.rows.length, 3);
  const ship = t.flow.rows.find((r: any) => r.to.key === 'sqs:shipping-order-events');
  assert.equal(ship.filter.agree, false);
  const col = t.flow.grid.destinations.findIndex((d: any) => d.queue.key === 'sqs:shipping-order-events');
  const cancelled = t.flow.grid.rows.find((r: any) => r.type === 'OrderCancelled').cells[col];
  assert.deepEqual([cancelled.status, cancelled.uncertain], ['no-handler', true]);
  assert.match(t.flow.summary.text, /orders-svc publishes 2 event types here; the topic fans out to 3 queues, each read by one service\./);
  assert.equal(t.flow.summary.callouts.length, 1);
  assert.equal(t.subscriptions.length, 4); // the older fields stay as they were

  const q = (await app.call('GET', `/api/envs/prod/channels/${encodeURIComponent('sqs:shipping-order-events')}`)).body;
  assert.equal(q.flow.layout, 'inbound');
  assert.equal(q.flow.rows.length, 1); // was "fed by sns:order-events" twice
  assert.equal(q.flow.rows[0].filter.declarations.length, 2);
});
