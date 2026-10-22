// Nested frames (#72): the model keeps each group's parent, the drawing nests the frames, the panel nests the blocks.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { altGroups } from '../core/alt.ts';
import { altFrames, chainOf } from '../web/js/views/sequence-alt.js';
import { altBlocks } from '../web/js/views/flow-inside.js';
import { startApp, readSample } from './helpers.ts';

const leaf = (seq: number, groups: any[] | undefined, extra: object = {}) => ({ seq, type: 'call', operation: `op${seq}`, note: 'x', kind: 'leaf', ...(groups ? { groups } : {}), ...extra });
const loop = { id: 'each', kind: 'loop', condition: 'for each item' };
const steps = [leaf(1, undefined), leaf(2, [loop, { id: 'pay', condition: 'card' }]), leaf(3, [loop, { id: 'pay', condition: 'invoice' }]), leaf(4, [loop]), leaf(5, undefined)];
function run(st: any[], opts: object = {}) {
  const g = buildIndex({ env: 't', services: [{ name: 's', kind: 'service', version: 1, harvestedAt: '2026-01-01' } as any], functions: [{ service: 's', id: 'main', name: 'main', steps: st } as any], ingress: [{ service: 's', id: 'in', bindKey: 'http:GET s/x', transport: 'http', handler: 'main' } as any], egress: [], resources: [], channels: [], bindings: [] });
  return trace(g, { service: 's', ingress: 'in' }, { scope: 'full', ...opts })!;
}

test('a step lists its frames outermost first: the model keeps each frame\'s parent', () => {
  const a = altGroups(steps as any, 'main');
  assert.equal(a.get(1), undefined);
  const inner = a.get(2)!;
  assert.deepEqual([inner.group, inner.branch, inner.of, inner.condition], ['main:pay', 1, 2, 'card']);
  assert.deepEqual([inner.parent!.group, inner.parent!.kind, inner.parent!.of, inner.parent!.branch], ['main:each', 'loop', 1, 1]);
  assert.equal(a.get(3)!.branch, 2);
  assert.equal(a.get(4)!.group, 'main:each');
  assert.equal(a.get(4)!.parent, undefined);
  assert.deepEqual(chainOf(inner).map((x: any) => x.group), ['main:each', 'main:pay']);
});

test('the trace carries the chain on the messages', () => {
  const m = run(steps).messages.filter((x) => x.kind !== 'entry');
  assert.deepEqual(m.map((x) => x.alt?.group ?? null), [null, 'main:pay', 'main:pay', 'main:each', null]);
  assert.equal(m[1].alt!.parent!.group, 'main:each');
});

test('nested frames count toward their parent branch only (the larger inner branch)', () => {
  // entry 1 + step 1 + the loop branch (inner max 1 + step 4 = 2) + step 5 = 5 counted of 7 shown
  const t = run(steps);
  assert.equal(t.messages.length, 6);
  assert.equal(run(steps, { maxMessages: 5 }).truncated, false);
  assert.equal(run(steps, { maxMessages: 4 }).truncated, true);
});

test('frames nest in the drawing: the loop frame holds the alt frame, each with its own tab strip', () => {
  const frames = altFrames(run(steps).messages as any) as any[];
  assert.deepEqual(frames.map((f) => [f.group, f.kind, f.level]), [['main:each', 'loop', 0], ['main:pay', 'alt', 1]]);
  const [outer, inner] = frames;
  assert.ok(inner.first >= outer.first && inner.last <= outer.last, 'inner inside outer');
  assert.deepEqual(outer.strips.map((s: any) => s.cond), ['for each item']);
  assert.deepEqual(inner.strips.map((s: any) => s.cond), ['card', 'invoice']);
  assert.ok(outer.last > inner.last, 'step 4 is in the loop after the alt');
});

test('the panel nests blocks the same way', () => {
  const items = altBlocks(run(steps).messages.filter((x) => x.kind !== 'entry').map((m) => ({ m, type: 'leaf' })) as any) as any[];
  assert.equal(items.length, 3);
  assert.equal(items[1].alt.kind, 'loop');
  assert.equal(items[1].branches.length, 1);
  const inside = items[1].branches[0].steps;
  assert.equal(inside.length, 2);
  assert.equal(inside[0].alt.group, 'main:pay');
  assert.deepEqual(inside[0].branches.map((b: any) => b.condition), ['card', 'invoice']);
});

test('the old altGroup keeps working, and an alt frame carries no kind', () => {
  const t = run([leaf(1, undefined, { altGroup: 'g', condition: 'a' }), leaf(2, undefined, { altGroup: 'g', condition: 'b' })]);
  assert.deepEqual(t.messages.filter((m) => m.alt).map((m) => m.alt!.kind), [undefined, undefined]);
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); });
after(() => app.close());

test('the schema accepts mark, groups and over (0.32.2), and refuses a bad mark, kind or an empty group id', async () => {
  const man = readSample('orders-svc.json');
  const place = (m: any) => m.functions.find((f: any) => f.id === 'OrderService.place');
  const ok = await app.call('POST', '/api/ingest?dryRun=1', { manifests: [{ ...man, version: 90 }] });
  assert.equal(ok.status, 200, JSON.stringify(ok.body).slice(0, 300));
  for (const patch of [{ mark: 'big' }, { groups: [{ id: '' }] }, { groups: [{ id: 'x', kind: 'maybe' }] }, { over: 'a' }]) {
    const bad = structuredClone(man); bad.version = 91; Object.assign(place(bad).steps[0], patch);
    const r = await app.call('POST', '/api/ingest?dryRun=1', { manifests: [bad] });
    assert.ok(r.status >= 400 && r.status < 500, JSON.stringify(patch));
  }
});

