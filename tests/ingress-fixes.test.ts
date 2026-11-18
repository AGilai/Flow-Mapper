// CR #132: `fixes` on an ingress hold for the whole walk from it (a shared router handler), a nearer step fix wins, the contract checks them.
// Demo: samples/objects-custom-url-lambda.json.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { startApp, SAMPLES } from './helpers.ts';

const G = (arms: Record<string, string[]>) => ({ group_id: 'g', name: 'route', arms: Object.entries(arms).map(([arm, step_ids]) => ({ arm, step_ids })) });
const call = (seq: number, target: string, extra: object = {}) => ({ seq, type: 'call', target, ...extra });
const leaf = (seq: number, op: string) => ({ seq, type: 'call', kind: 'leaf', operation: op });
const alts = G({ a: ['s:main#1'], b: ['s:main#2'] });
/** main: #1 -> fa (arm a), #2 -> fb (arm b); one ingress per route sharing `main`. */
function model(ingressFixes: Record<string, any[] | undefined>, mainStepExtra: object = {}) {
  return buildIndex({
    env: 't', services: [{ name: 's', kind: 'service', version: 1, harvestedAt: '2026-01-01' }],
    functions: [
      { service: 's', id: 'main', name: 'main', steps: [call(1, 'fa', { alternatives: [alts], ...mainStepExtra }), call(2, 'fb', { alternatives: [alts] })] },
      { service: 's', id: 'fa', name: 'fa', steps: [leaf(1, 'opA')] }, { service: 's', id: 'fb', name: 'fb', steps: [leaf(1, 'opB')] },
    ],
    ingress: Object.entries(ingressFixes).map(([id, fixes]) => ({ service: 's', id, bindKey: `http:GET s/${id}`, transport: 'http', handler: 'main', ...(fixes ? { fixes } : {}) })),
    egress: [], resources: [], channels: [], bindings: [],
  } as any);
}
const ops = (g: any, id: string, o: object = {}) => trace(g, { service: 's', ingress: id }, { scope: 'full', ...o })!.messages.map((m: any) => m.label).filter((l: string) => l.startsWith('op'));

test('an ingress fix shows only its arm; an ingress without fixes still walks both', () => {
  const g = model({ ra: [{ group_id: 'g', arm: 'a' }], rb: [{ group_id: 'g', arm: 'b' }], rn: undefined });
  assert.deepEqual(ops(g, 'ra'), ['opA']);
  assert.deepEqual(ops(g, 'rb'), ['opB']);
  assert.deepEqual(ops(g, 'rn'), ['opA', 'opB']);
  const t = trace(g, { service: 's', ingress: 'ra' }, { scope: 'full' })!;
  assert.equal(t.decisions![0].lock!.arm, 'a');
  assert.equal(t.decisions![0].lock!.at, 's:ra');
});

test('simple mode honours the ingress fix too', () => {
  const g = model({ ra: [{ group_id: 'g', arm: 'a' }] });
  assert.deepEqual(ops(g, 'ra', { detail: 'simple' }), ['opA']);
});

test('a nearer step fix overrides the ingress fix for the same group', () => {
  const h = { group_id: 'h', arms: [{ arm: 'x', step_ids: ['s:fb#1'] }, { arm: 'y', step_ids: ['s:fb#2'] }] };
  const mk = (stepFix: any[]) => buildIndex({
    env: 't', services: [{ name: 's', kind: 'service', version: 1, harvestedAt: '2026-01-01' }],
    functions: [{ service: 's', id: 'main', name: 'main', steps: [call(1, 'fb', stepFix.length ? { fixes: stepFix } : {})] }, { service: 's', id: 'fb', name: 'fb', steps: [{ ...leaf(1, 'opX'), alternatives: [h] }, leaf(2, 'opY')] }],
    ingress: [{ service: 's', id: 'r', bindKey: 'http:GET s/r', transport: 'http', handler: 'main', fixes: [{ group_id: 'h', arm: 'x' }] }], egress: [], resources: [], channels: [], bindings: [],
  } as any);
  assert.deepEqual(ops(mk([]), 'r'), ['opX']);                                   // the ingress fix holds below
  assert.deepEqual(ops(mk([{ group_id: 'h', arm: 'y' }]), 'r'), ['opY']);        // the step's fix is nearer and wins
});

test('the contract: unknown group and arm are errors, an unreached group a warning', async () => {
  const app = await startApp();
  try {
    const manifest = JSON.parse(readFileSync(`${SAMPLES}/objects-custom-url-lambda.json`, 'utf8'));
    const codes = async (fixes: any[]) => {
      const m = structuredClone(manifest); m.ingress[0].fixes = fixes;
      const r = (await app.call('POST', '/api/ingest?dryRun=1', { manifests: [m] })).body.results[0].contract.findings;
      return r.filter((f: any) => f.code.startsWith('ingress-fix')).map((f: any) => `${f.level}:${f.code}`);
    };
    const gid = manifest.ingress[0].fixes[0].group_id;
    assert.deepEqual(await codes([{ group_id: gid, arm: 'list' }]), []);
    assert.deepEqual(await codes([{ group_id: 'nope', arm: 'list' }]), ['error:ingress-fix-unknown-group']);
    assert.deepEqual(await codes([{ group_id: gid, arm: 'nope' }]), ['error:ingress-fix-unknown-arm']);
    // a group of another function tree, never reached from this ingress
    const m = structuredClone(manifest);
    m.functions.push({ id: 'other', name: 'other', steps: [{ seq: 1, type: 'resource', target: 'customUrlsTable', operation: 'scan', access: 'read', alternatives: [{ group_id: 'lonely', arms: [{ arm: 'x', step_ids: [] }] }] }] });
    m.ingress[0].fixes = [{ group_id: 'lonely', arm: 'x' }];
    const r = (await app.call('POST', '/api/ingest?dryRun=1', { manifests: [m] })).body.results[0].contract.findings;
    assert.deepEqual(r.filter((f: any) => f.code.startsWith('ingress-fix')).map((f: any) => `${f.level}:${f.code}`), ['warn:ingress-fix-unreached-group']);
  } finally { await app.close(); }
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); assert.equal((await app.call('POST', '/api/ingest', { manifests: [JSON.parse(readFileSync(`${SAMPLES}/objects-custom-url-lambda.json`, 'utf8'))] })).status, 201); });
after(async () => { await app.close(); });

const Q = '/api/envs/prod/trace?service=objects-custom-url-lambda&ingress=';
const messages = async (ing: string, q = '') => ((await app.call('GET', Q + ing + '&detail=full' + q)).body.messages as any[]).map((m) => m.label);
const mcp = async (ingress: string, detail = 'full') => JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trace_flow', arguments: { env: 'prod', service: 'objects-custom-url-lambda', ingress, detail } } })).body.result.content[0].text);

test('the demo: each route of the shared handler shows only its arm (REST full and simple)', async () => {
  const create = await messages('in.create');
  assert.ok(create.some((x) => x.includes('createCustomUrl')) && !create.some((x) => /deleteCustomUrl|listCustomUrls|getCustomUrl/.test(x)), create.join(' | '));
  const simple = ((await app.call('GET', Q + 'in.list&detail=simple')).body.messages as any[]).map((m) => m.label).join(' | ');
  assert.ok(simple.includes('query') && !/putItem|deleteItem|getItem/.test(simple), simple);
});

test('MCP trace_flow honours the ingress fix', async () => {
  const t = await mcp('in.delete');
  const l = t.messages.map((m: any) => m.label).join(' | ');
  assert.ok(l.includes('deleteCustomUrl') && !/createCustomUrl|getCustomUrl|listCustomUrls/.test(l), l);
  assert.equal(t.decisions[0].lock.arm, 'delete');
});
