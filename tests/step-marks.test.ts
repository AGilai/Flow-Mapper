// Step marks (#75, 0.32.1): the flag on a step, Changed only, the band on the arrow, the design edit; and the 0.32.1 demo flow.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace, entryPoints } from '../core/trace.ts';
import { flowCounts, markedReached } from '../core/flow-counts.ts';
import { decorateEntries } from '../core/flow-text.ts';
import { designEditOps, EditError, type DesignEdit } from '../core/design-edit.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { arrowMark, laneMarks, stepMarksOnly } from '../web/js/views/flow-marks.js';
// @ts-ignore
import { markOfPoint, filterPoints } from '../web/js/views/flow-list-filter.js';

const svc = (name: string) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' }) as any;
function build(steps: any[]) {
  return buildIndex({ env: 't', services: [svc('a'), svc('b'), svc('c')],
    functions: [{ service: 'a', id: 'main', name: 'main', steps } as any, { service: 'b', id: 'hb', name: 'hb', steps: [] } as any, { service: 'c', id: 'hc', name: 'hc', steps: [] } as any],
    ingress: [{ service: 'a', id: 'in', bindKey: 'http:GET a/x', transport: 'http', handler: 'main' } as any, { service: 'b', id: 'in.b', bindKey: 'http:GET b/x', transport: 'http', handler: 'hb' } as any, { service: 'c', id: 'in.c', bindKey: 'http:GET c/x', transport: 'http', handler: 'hc' } as any],
    egress: [{ service: 'a', id: 'out.b', bindKey: 'http:GET b/x', transport: 'http' } as any, { service: 'a', id: 'out.c', bindKey: 'http:GET c/x', transport: 'http' } as any], resources: [], channels: [], bindings: [] });
}
const steps = [
  { seq: 1, type: 'egress', target: 'out.b', operation: 'GET x', mark: 'new', details: { changed: 'a brand new call' } },
  { seq: 2, type: 'egress', target: 'out.c', operation: 'GET y', mark: 'changed' },
  { seq: 3, type: 'call', kind: 'leaf', operation: 'done', note: 'all agree', over: ['a', 'b', 'c'] },
];
const run = (g: any) => trace(g, { service: 'a', ingress: 'in' }, { scope: 'full' })!;

test('#75: the message carries the step mark and its details.changed text; the counts skip the marked-step ids', () => {
  const g = build(steps), m = run(g).messages.filter((x) => x.kind !== 'entry');
  assert.deepEqual(m.map((x) => x.mark ?? null), ['new', 'changed', null]);
  assert.equal(m[0].changed, 'a brand new call');
  assert.equal(m[1].changed, undefined);
  const plain = build(steps.map(({ mark, ...s }) => s));
  assert.deepEqual(flowCounts(g).map((c) => c.total), flowCounts(plain).map((c) => c.total), 'marks are not components');
});

test('#75: an entry point whose flow runs marked steps counts as changed (Changed only)', () => {
  const g = build(steps), marked = markedReached(g);
  assert.equal(marked.get('a:in'), 2);
  assert.equal(marked.has('b:in.b'), false);
  const pts = decorateEntries(entryPoints(g), new Map(), undefined, undefined, marked);
  const a = pts.find((p) => p.id === 'in')!, b = { ...a, id: 'other', marked: undefined } as any;
  assert.equal((a as any).marked, 2);
  assert.deepEqual(markOfPoint(null, a), { mark: 'changed', what: '2 marked steps' });
  assert.equal(markOfPoint(null, b), null);
  assert.deepEqual(filterPoints([a, b].map((p: any) => ({ ...p, bindKey: p.bindKey ?? '', handler: p.handler ?? '' })), { changed: '1' }).map((p: any) => p.id), ['in']);
});

test('#75: the arrow takes the step\'s own mark, without a marks store too; a diff mark does not hide it', () => {
  const m = run(build(steps)).messages.filter((x) => x.kind !== 'entry')[0];
  assert.deepEqual(arrowMark(null, m)?.info, { mark: 'new', what: 'a brand new call' });
  assert.equal(laneMarks(null), null);
  assert.equal(stepMarksOnly.arrow(m).inDraft, false);
  assert.equal(stepMarksOnly.arrow({ ...m, mark: undefined }), null);
  const store = { markOf: () => ({ mark: 'changed' }), inDraft: () => true, empty: false };
  assert.equal(laneMarks(store).arrow(m).info.mark, 'new');
});

test('#75: a design edit sets and clears the step mark; anything else is refused', () => {
  const rows: any[] = [{ service: 'a', list: 'header', key: '', data: { kind: 'service' } }, { service: 'b', list: 'header', key: '', data: { kind: 'service' } },
    { service: 'a', list: 'functions', key: 'f', data: { id: 'f', name: 'f', steps: [] } }, { service: 'b', list: 'ingress', key: 'in.x', data: { id: 'in.x', bindKey: 'http:GET b/x', transport: 'http', handler: 'h' } }];
  const edit = (x: object, r = rows) => designEditOps({ kind: 'call', from: { service: 'a', fn: 'f' }, to: { service: 'b', ingress: 'in.x' }, ...x } as DesignEdit, r);
  const added = edit({ mark: 'new' });
  const withStep = (o: any[]) => o.find((p) => p.anchor === 'fn:a/f').data.steps;
  assert.equal(withStep(added)[0].mark, 'new');
  const rows2 = rows.map((r) => (r.list === 'functions' ? { ...r, data: { ...r.data, steps: withStep(added) } } : r));
  const eg = withStep(added)[0].target;
  assert.equal(withStep(edit({ edit: { egress: eg, seq: 1 } }, rows2))[0].mark, 'new', 'an edit that does not mention it keeps it');
  assert.equal(withStep(edit({ edit: { egress: eg, seq: 1 }, mark: 'changed' }, rows2))[0].mark, 'changed');
  assert.equal(withStep(edit({ edit: { egress: eg, seq: 1 }, mark: null }, rows2))[0].mark, undefined);
  assert.throws(() => edit({ mark: 'big' }), (e: any) => e instanceof EditError && e.field === 'mark');
});


test('the sample: orders-svc in.get has a loop frame holding an alt frame, marked steps and a note over three lifelines', () => {
  const g = buildIndex(sampleModel()), t = trace(g, { service: 'orders-svc', ingress: 'in.get' }, { scope: 'full' })!;
  const inLoop = t.messages.filter((m) => m.alt?.parent?.kind === 'loop');
  assert.equal(inLoop.length, 3);
  assert.ok(inLoop.every((m) => m.alt!.group.endsWith(':fill') && m.alt!.of === 2));
  assert.deepEqual(t.messages.filter((m) => m.mark).map((m) => m.mark), ['changed', 'new']);
  assert.deepEqual(t.messages.find((m) => m.over)!.over, ['orders-svc', 'cache-main', 'orders-db']);
  assert.equal(markedReached(g).get('api-gateway:in.getOrder'), 2);
  const lane = buildLane(t.messages, { scope: t.scope, participants: t.participants });
  assert.deepEqual(lane.events.find((e: any) => e.type === 'note').cols.map((c: any) => c.label), ['orders-svc', 'order:{id}', 'orders']);
});

