// Perf batch 3, F6: the Flows list's decision counts are computed in slices without changing a number, and notes/index is memoised between writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { flowDecisions, flowDecisionsAsync } from '../core/flow-decisions.ts';
import { sampleModel, sampleManifests, startApp } from './helpers.ts';

test('F6: flowDecisionsAsync gives the same map, same order, as flowDecisions, yielding between flows', async () => {
  const sync = flowDecisions(buildIndex(sampleModel()));
  assert.ok(sync.size >= 1, 'the samples have flows with decisions');
  const g = buildIndex(sampleModel());
  let yields = 0;
  const [a, b] = await Promise.all([flowDecisionsAsync(g, async () => { yields++; await new Promise((r) => setImmediate(r)); }, 0), flowDecisionsAsync(g, async () => { yields++; }, 0)]);
  assert.equal(a, b, 'two callers share one run');
  assert.ok(yields >= 1, 'it let other work through');
  assert.deepEqual([...a], [...sync]);
  assert.equal(flowDecisions(g), a, 'the sync reader sees the finished memo');
  assert.equal(await flowDecisionsAsync(g, async () => { throw new Error('no yield on a memo hit'); }), a);
  // a graph with no alternatives costs nothing
  const plain = buildIndex({ ...sampleModel(), functions: sampleModel().functions.map((f: any) => ({ ...f, steps: (f.steps ?? []).map(({ altGroup, condition, groups, ...s }: any) => s) })) });
  assert.deepEqual([...(await flowDecisionsAsync(plain, async () => {}))], [...flowDecisions(plain)]);
});

test('F6: a slow flows/counts does not hold up another request, and the answer is the same', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
    const first = await app.call('GET', '/api/envs/prod/flows/counts');
    const second = await app.call('GET', '/api/envs/prod/flows/counts');
    assert.equal(first.status, 200);
    assert.deepEqual(second.body, first.body);
    assert.ok(first.body.some((r: any) => r.decisions));
    // two at once on a cold graph (an ingest drops it) both answer
    const m = JSON.parse(JSON.stringify(sampleManifests().find((x: any) => x.service.name === 'member-api')));
    m.version += 5;
    assert.equal((await app.call('POST', '/api/ingest', m)).status, 201);
    const [x, y] = await Promise.all([app.call('GET', '/api/envs/prod/flows/counts'), app.call('GET', '/api/envs/prod/flows/counts')]);
    assert.deepEqual(x.body, y.body);
    assert.deepEqual(x.body, first.body);
  } finally { await app.close(); }
});

test('F6: notes/index is the same list, and a note write changes it', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
    const put = (anchor: string, body: string) => app.call('PUT', '/api/envs/prod/notes', { anchor, author: 'Ana', body });
    assert.deepEqual((await app.call('GET', '/api/envs/prod/notes/index')).body, {});
    assert.equal((await put('flow:api-gateway/in.createOrder', '<p>text</p>')).status, 200);
    assert.equal((await put('flow:api-gateway/in.getOrder', '<p></p>')).status, 200);
    const idx = (await app.call('GET', '/api/envs/prod/notes/index')).body;
    assert.deepEqual(idx, { 'flow:api-gateway/in.createOrder': 1 }, 'a note with no text is not listed');
    assert.deepEqual((await app.call('GET', '/api/envs/prod/notes/index')).body, idx);
    assert.equal((await put('flow:api-gateway/in.createOrder', '<p>more</p>')).status, 200);
    assert.deepEqual((await app.call('GET', '/api/envs/prod/notes/index')).body, { 'flow:api-gateway/in.createOrder': 2 });
    assert.equal((await put('flow:api-gateway/in.createOrder', '')).status, 200);
    assert.deepEqual((await app.call('GET', '/api/envs/prod/notes/index')).body, {}, 'cleared notes drop out');
  } finally { await app.close(); }
});
