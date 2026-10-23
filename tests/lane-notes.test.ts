// Notes over several lifelines (#74, 0.32.2): the lane row and the box geometry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
// @ts-ignore plain JS modules shared with the browser
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { noteBox } from '../web/js/views/flow-draw-notes.js';

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

test('#74: a leaf note over several components is one row over all of them; over one it stays under it', () => {
  const t = run(build(steps)), lane = buildLane(t.messages, { scope: t.scope, participants: t.participants });
  const note = lane.events.find((e: any) => e.type === 'note');
  assert.deepEqual(note.cols.map((c: any) => c.service).sort(), ['a', 'b', 'c']);
  assert.equal(note.text, 'done · all agree');
  const one = buildLane(trace(build([{ ...steps[2], over: ['b'] }, steps[0]]), { service: 'a', ingress: 'in' }, { scope: 'full' })!.messages, { scope: 'full', participants: t.participants });
  assert.deepEqual(one.events.find((e: any) => e.type === 'note').cols.map((c: any) => c.service), ['b']);
  assert.equal(buildLane(run(build([{ ...steps[2], over: undefined }])).messages, { scope: 'full', participants: t.participants }).events.some((e: any) => e.type === 'note'), false, 'a leaf without over is not drawn, as before');
});

test('#74: the note box spans leftmost to rightmost lifeline, out to the edge of a fold column', () => {
  const cols = ['a', 'b', 'c', 'd'].map((n) => ({ n })), idx = new Map(cols.map((c, i) => [c, i])), colX = new Map(cols.map((c, i) => [c, 100 + i * 150]));
  const geo = { colX, idx, groups: [] as any[] };
  const span = noteBox([cols[0], cols[2]], 10, geo);
  assert.deepEqual([span.x, span.x + span.w], [100 - 14, 400 + 14]);
  const one = noteBox([cols[1]], 10, geo);
  assert.equal(one.x + one.w / 2, 250, 'centred under its lifeline');
  assert.ok(one.w >= 96 && one.w <= 260);
  const folded = noteBox([cols[0], cols[3]], 10, { ...geo, groups: [{ cols: [3], x: 540, w: 100 }] });
  assert.equal(folded.x + folded.w, 640, 'a folded lifeline: to the right edge of its fold');
  assert.ok(noteBox([cols[0], cols[0]], 10, geo).w <= 260, 'the same lifeline twice is one lifeline');
});


test('#83: a return leaf (a branch that holds only a return) is drawn as a return arrow back to its component', () => {
  const t = run(build([steps[0], { seq: 2, type: 'call', kind: 'leaf', operation: '403 denied', details: { return_to: 'a' } }]));
  assert.equal(t.messages.find((m: any) => m.label === '403 denied')?.returnTo, 'a');
  const lane = buildLane(t.messages, { scope: t.scope, participants: t.participants });
  const back = lane.events.filter((e: any) => e.type === 'return' && e.label === '403 denied');
  assert.equal(back.length, 1);
  assert.equal(back[0].to.service, 'a');
});
