// Alternatives (#41): steps that exclude each other carry `alt` and are drawn as one alt frame.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { altGroups } from '../core/alt.ts';
import { flowCounts } from '../core/flow-counts.ts';
import { sampleModel, readSample, startApp } from './helpers.ts';

const leaf = (seq: number, extra: object = {}) => ({ seq, type: 'call', operation: `op${seq}`, note: 'x', kind: 'leaf', ...extra });
const src = (line: number) => ({ file: 'a.ts', line });
function build(steps: any[], more: any[] = []) {
  const fns = [{ service: 's', id: 'main', name: 'main', steps }, ...more.map((f) => ({ service: 's', ...f }))];
  return buildIndex({ env: 't', services: [{ name: 's', kind: 'service', version: 1, harvestedAt: '2026-01-01' } as any], functions: fns as any, ingress: [{ service: 's', id: 'in', bindKey: 'http:GET s/x', transport: 'http', handler: 'main' } as any], egress: [], resources: [], channels: [], bindings: [] });
}
const run = (g: any, opts: object = {}) => trace(g, { service: 's', ingress: 'in' }, { scope: 'full', ...opts })!;
const alts = (t: any) => t.messages.filter((m: any) => m.kind !== 'entry').map((m: any) => m.alt && [m.alt.branch, m.alt.of]);

test('explicit altGroup: one branch per condition, steps outside the group are untouched', () => {
  const t = run(build([leaf(1, { altGroup: 'g', condition: 'a' }), leaf(2, { altGroup: 'g', condition: 'b' }), leaf(3, { altGroup: 'g', condition: 'c' }), leaf(4, { condition: 'd' })]));
  assert.deepEqual(alts(t), [[1, 3], [2, 3], [3, 3], undefined]);
  assert.equal(new Set(t.messages.filter((m) => m.alt).map((m) => m.alt!.group)).size, 1);
  assert.ok(t.messages.filter((m) => m.alt).every((m) => m.condition), 'the message keeps its condition');
});

test('explicit altGroup: steps with the same condition share a branch; one branch is no group', () => {
  assert.deepEqual(alts(run(build([leaf(1, { altGroup: 'g', condition: 'a' }), leaf(2, { altGroup: 'g', condition: 'b' }), leaf(3, { altGroup: 'g', condition: 'a' })]))), [[1, 2], [2, 2], [1, 2]]);
  assert.deepEqual(alts(run(build([leaf(1, { altGroup: 'g', condition: 'a' }), leaf(2, { altGroup: 'g', condition: 'a' })]))), [undefined, undefined]);
});

test('fallback: consecutive conditional steps with the same source line form a group', () => {
  const steps = [leaf(1, { condition: 'x', source: src(5) }), leaf(2, { condition: 'y', source: src(5) }), leaf(3, { condition: 'z', source: src(6) }), leaf(4, { condition: 'w', source: src(6) }),
    leaf(5, { source: src(7) }), leaf(6, { condition: 'q', source: src(7) }), leaf(7, { condition: 'q', source: src(8) }), leaf(8, { condition: 'q', source: src(8) })];
  assert.deepEqual(alts(run(build(steps))), [[1, 2], [2, 2], [1, 2], [2, 2], undefined, undefined, undefined, undefined]);
  const groups = [...altGroups(steps as any).values()].map((a) => a.group);
  assert.notEqual(groups[0], groups[2]);
  // not consecutive: an unrelated step in between breaks the run
  assert.deepEqual(alts(run(build([leaf(1, { condition: 'x', source: src(5) }), leaf(2), leaf(3, { condition: 'y', source: src(5) })]))), [undefined, undefined, undefined]);
});

test('each branch keeps its downstream subtree; the subtree is not part of the group', () => {
  const g = build([leaf(1, { altGroup: 'g', condition: 'a' }), { seq: 2, type: 'call', target: 'f', altGroup: 'g', condition: 'b' }, leaf(3, { altGroup: 'g', condition: 'c' })],
    [{ id: 'f', name: 'f', steps: [leaf(1), leaf(2), leaf(3)] }]);
  const t = run(g);
  assert.deepEqual(t.messages.map((m) => [m.depth, m.alt?.branch]), [[0, undefined], [1, 1], [1, 2], [2, undefined], [2, undefined], [2, undefined], [1, 3]]);
});

test('maxMessages counts the largest branch, not the sum of the branches', () => {
  const g = build([leaf(1, { altGroup: 'g', condition: 'a' }), { seq: 2, type: 'call', target: 'f', altGroup: 'g', condition: 'b' }, leaf(3, { altGroup: 'g', condition: 'c' }), leaf(4, { altGroup: 'g', condition: 'c' })],
    [{ id: 'f', name: 'f', steps: [leaf(1), leaf(2), leaf(3)] }]);
  // entry + (branch b: the call and its 3 leaves = 4) = 5 count; the 8 messages shown are 1 + 1 + 4 + 2
  assert.equal(run(g, { maxMessages: 5 }).messages.length, 8);
  assert.equal(run(g, { maxMessages: 5 }).truncated, false);
  const cut = run(g, { maxMessages: 4 });
  assert.equal(cut.truncated, true);
  // the same steps in sequence use all 8
  const seq = build([leaf(1), { seq: 2, type: 'call', target: 'f' }, leaf(3), leaf(4)], [{ id: 'f', name: 'f', steps: [leaf(1), leaf(2), leaf(3)] }]);
  assert.equal(run(seq, { maxMessages: 5 }).truncated, true);
});

test('a group inside a branch counts toward that branch only', () => {
  const inner = [leaf(1, { altGroup: 'i', condition: 'p' }), leaf(2, { altGroup: 'i', condition: 'q' }), leaf(3, { altGroup: 'i', condition: 'q' })];
  const g = build([{ seq: 1, type: 'call', target: 'f', altGroup: 'o', condition: 'a' }, leaf(2, { altGroup: 'o', condition: 'b' })], [{ id: 'f', name: 'f', steps: inner }]);
  // entry 1 + the call 1 + the larger inner branch q (2) = 4 counted, 6 shown
  assert.equal(run(g, { maxMessages: 3 }).truncated, true);
  assert.equal(run(g, { maxMessages: 4 }).messages.length, 6);
  assert.equal(run(g, { maxMessages: 4 }).truncated, false);
});

const demo = { service: 'account-lambda-erase-controller', ingress: 'in.advanceErase' };

test('demo: four priority alternatives, the last one with a call; flow counts add each component once', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, demo, { scope: 'full' })!;
  const inFrame = t.messages.filter((m) => m.alt);
  assert.deepEqual([...new Set(inFrame.map((m) => m.alt!.branch))], [1, 2, 3, 4]);
  assert.deepEqual(inFrame.filter((m) => m.kind === 'call').map((m) => m.label), ['record_final_priority']);
  assert.ok(inFrame.every((m) => m.alt!.of === 4 && m.alt!.group === 'advance_erase:next-priority'));
  assert.deepEqual([...new Set(inFrame.map((m) => m.condition))], ['nextPriority == 10', 'nextPriority == 15', 'nextPriority == 20', 'nextPriority == 30']);
  // the branches send to the same topic and queues: those components are counted once, not four times
  const c = flowCounts(g).find((x) => x.service === demo.service && x.ingress === demo.ingress)!;
  const comps = t.participants.filter((p) => ['service', 'channel', 'resource'].includes(p.kind)).length;
  assert.equal(c.total, comps);
  assert.equal(c.topics, 1);
  // 4 branches of the same shape: far fewer counted messages than shown
  const small = trace(g, demo, { scope: 'full', maxMessages: 20 })!;
  assert.equal(small.truncated, false);
  assert.ok(t.messages.length > 20);
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); });
after(() => app.close());

test('API and MCP trace_flow return alt; the schema accepts altGroup and rejects a non-string', async () => {
  const man = readSample('account-lambda-erase-controller.json');
  const r = await app.call('POST', '/api/ingest', { manifests: [man] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const q = '/api/envs/prod/trace?service=account-lambda-erase-controller&ingress=in.advanceErase&scope=intra';
  const api = (await app.call('GET', q)).body;
  assert.deepEqual(api.messages.filter((m: any) => m.alt).map((m: any) => [m.alt.branch, m.alt.of]), [[1, 4], [2, 4], [3, 4], [4, 4], [4, 4]]);
  const res = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trace_flow', arguments: { env: 'prod', service: 'account-lambda-erase-controller', ingress: 'in.advanceErase', scope: 'intra' } } });
  const mcp = JSON.parse(res.body.result.content[0].text);
  assert.equal(mcp.messages.filter((m: any) => m.alt).length, 5);
  const bad = structuredClone(man); bad.version = 9;
  bad.functions.find((f: any) => f.id === 'advance_erase').steps[0].altGroup = 7;
  const rej = await app.call('POST', '/api/ingest?dryRun=1', { manifests: [bad] });
  assert.ok(rej.status >= 400 && rej.status < 500);
});
