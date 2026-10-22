// Perf batch 3: the cheaper code paths give exactly what the old ones gave (F9 annotation writes, F7 copy, F8 drafts, F11, F12, F6, gzip).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { HASH_TRACE, hasStep, stepKeys } from '../core/description.ts';
import { flowExists, flowSteps, hasStepIn } from '../server/store/flow-check.ts';
import { generateMock } from '../scripts/mock/generate.ts';
import { sampleModel, startDesign } from './helpers.ts';

function mockModel(n = 60): any {
  const model: any = { env: 'm', services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };
  for (const m of generateMock({ services: n, seed: 7, env: 'm' })) {
    model.services.push({ ...m.service, version: m.version, harvestedAt: m.harvestedAt, commit: m.commit });
    for (const l of ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings']) for (const e of m[l] ?? []) model[l].push({ ...e, service: m.service.name, ...(l === 'functions' ? { steps: e.steps ?? [] } : {}) });
  }
  return model;
}

test('F9: flowExists is the old "trace is not null" on every ingress, a missing one and an empty model', () => {
  for (const model of [sampleModel(), mockModel()]) {
    const g = buildIndex(model);
    for (const i of model.ingress) assert.equal(flowExists(g, i.service, i.id), trace(g, { service: i.service, ingress: i.id }, HASH_TRACE) !== null, `${i.service}/${i.id}`);
    assert.equal(flowExists(g, model.ingress[0].service, 'nope'), false);
    assert.equal(flowExists(g, 'nope', model.ingress[0].id), false);
    // an ingress whose handler is gone: the old trace gave null as well
    const broken = { ...model, ingress: model.ingress.map((i: any, k: number) => (k === 0 ? { ...i, handler: 'gone-fn' } : i)) };
    const gb = buildIndex(broken), i0 = broken.ingress[0];
    assert.equal(flowExists(gb, i0.service, i0.id), trace(gb, { service: i0.service, ingress: i0.id }, HASH_TRACE) !== null);
    // an ingress with no handler: an empty flow, not a 404
    const bare = { ...model, ingress: model.ingress.map((i: any, k: number) => { if (k !== 0) return i; const { handler, ...r } = i; return r; }) };
    const gn = buildIndex(bare), n0 = bare.ingress[0];
    assert.equal(flowExists(gn, n0.service, n0.id), trace(gn, { service: n0.service, ingress: n0.id }, HASH_TRACE) !== null);
  }
  assert.equal(flowExists(buildIndex({ env: 'x', services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] }), 'a', 'b'), false);
});

test('F9: the memoised steps answer like hasStep, once per graph', () => {
  const model = sampleModel(), g = buildIndex(model), i = model.ingress.find((x: any) => x.service === 'api-gateway' && x.id === 'in.createOrder');
  const s = flowSteps(g, 'prod', i.service, i.id);
  assert.equal(flowSteps(g, 'prod', i.service, i.id), s);
  assert.notEqual(flowSteps(buildIndex(model), 'prod', i.service, i.id), s); // a new graph (any change) means a fresh trace
  for (const k of [...stepKeys(s.t.messages), 'step:x>y|nope|', stepKeys(s.t.messages)[1] + '~7']) assert.equal(hasStepIn(s, k), hasStep(s.t, k), k);
  assert.throws(() => flowSteps(g, 'prod', 'nope', 'nope'), /not found|ingress/i);
});

test('F9: comments, action items and notes keep their errors and results', async () => {
  const app = await startDesign();
  try {
    const A = 'flow:api-gateway/in.createOrder', B = 'flow:api-gateway/in.nope';
    const t = (await app.call('GET', '/api/envs/prod/trace?detail=full&service=api-gateway&ingress=in.createOrder&scope=full&maxMessages=2000')).body;
    const keys = stepKeys(t.messages);
    const c = (b: object) => app.call('POST', '/api/envs/prod/comments', { anchor: A, author: 'Ana', body: '<p>x</p>', ...b });
    assert.equal((await c({})).status, 201);
    assert.equal((await c({ step: keys[1] })).status, 201);
    assert.equal((await c({ steps: { from: keys[1], to: keys[3] } })).status, 201);
    assert.equal((await c({ step: 'step:a>b|c|' })).status, 400);
    assert.equal((await c({ steps: { from: keys[3], to: keys[1] } })).status, 400);
    assert.equal((await c({ anchor: B })).status, 404);
    const ai = (b: object) => app.call('POST', '/api/envs/prod/action-items', { anchor: A, actor: 'Ana', owner: 'Ben', description: 'do it', ...b });
    assert.ok([200, 201].includes((await ai({})).status));
    assert.ok([200, 201].includes((await ai({ step: keys[2] })).status));
    assert.equal((await ai({ step: 'step:a>b|c|' })).status, 400);
    assert.equal((await ai({ anchor: B })).status, 404);
    const n = (b: object) => app.call('PUT', '/api/envs/prod/notes', { anchor: A, author: 'Ana', body: '<p>n</p>', ...b });
    assert.equal((await n({})).status, 200);
    assert.equal((await n({ anchor: B })).status, 404);
  } finally { await app.close(); }
});
