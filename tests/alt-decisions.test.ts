// 0.38.2 (#82): the older either/or mechanism (altGroup, an implicit file:line group, a design `groups` frame of kind alt) is a scenario decision:
// group_id = alt.group, arms b1..bN labelled with the condition; opt / loop are not choices; a group that hosts `alternatives` is not counted twice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { viewOf } from '../core/trace-view.ts';
import { parseChoose } from '../core/trace-view-params.ts';
import { sampleModel } from './helpers.ts';
import { exportMermaid } from '../core/mermaid-export.ts';
// @ts-ignore plain JS module shared with the browser
import { encodeChoose, applyChoose, decodeChoose } from '../web/js/views/flow-scenario-pure.js';

const leaf = (seq: number, extra: object = {}) => ({ seq, type: 'call', kind: 'leaf', operation: `op${seq}`, ...extra });
const call = (seq: number, target: string, extra: object = {}) => ({ seq, type: 'call', target, ...extra });
const svc = { name: 's', kind: 'service', version: 1, harvestedAt: '2026-01-01' };
function run(fns: Record<string, any[]>) {
  const functions = Object.entries(fns).map(([id, steps]) => ({ service: 's', id, name: id, steps }));
  const model: any = { env: 't', services: [svc], functions, ingress: [{ service: 's', id: 'in', bindKey: 'http:GET s/x', transport: 'http', handler: 'main' }], egress: [], resources: [], channels: [], bindings: [] };
  return trace(buildIndex(model), { service: 's', ingress: 'in' }, { scope: 'full', maxMessages: 500 })!;
}
const src = (line: number) => ({ file: 'a.js', line });

test('altGroup flow: a 4-arm decision (advanceErase), arms b1..b4 labelled with the condition', () => {
  const t = trace(buildIndex(sampleModel()), { service: 'account-lambda-erase-controller', ingress: 'in.advanceErase' }, { scope: 'full', maxMessages: 500 })!;
  assert.equal(t.decisions!.length, 1);
  const d = t.decisions![0];
  assert.equal(d.group_id, 'advance_erase:next-priority');
  assert.equal(d.name, 'nextPriority');
  assert.deepEqual(d.arms.map((a) => [a.arm, a.label]), [['b1', 'nextPriority == 10'], ['b2', 'nextPriority == 15'], ['b3', 'nextPriority == 20'], ['b4', 'nextPriority == 30']]);
  assert.equal(d.depends_on, undefined);
  assert.equal(d.guard?.file, 'erase_controller/advance.py');
  assert.ok(t.messages.every((m) => m.key), 'keys are stamped');
  // the default is the first branch, no frame; All shows every branch with its frames
  const first = viewOf(t, {});
  assert.equal(first.decisions![0].chosen, 'b1');
  assert.ok(first.messages.every((m) => !m.alt) && first.messages.every((m) => !m.arms?.some((e) => !e.endsWith(':b1'))));
  const all = viewOf(t, { choose: { '*': 'both' } });
  assert.ok(all.messages.some((m) => m.alt?.branch === 4));
  assert.ok(all.messages.length > first.messages.length);
  assert.equal(all.counts!.messages.min < all.counts!.messages.max, true, 'counts are a range with All');
  // the deepest message (below the last branch's call) belongs to that branch
  const leafM = t.messages[t.messages.length - 1];
  assert.deepEqual(leafM.arms, ['advance_erase:next-priority:b4']);
});

test('implicit group: consecutive steps with the same file:line and a condition', () => {
  const t = run({ main: [leaf(1, { condition: 'x > 1', source: src(10) }), leaf(2, { condition: 'x < 1', source: src(10) }), leaf(3)] });
  assert.equal(t.decisions!.length, 1);
  assert.deepEqual(t.decisions![0].arms.map((a) => a.label), ['x > 1', 'x < 1']);
  assert.equal(t.decisions![0].name, 'x');
  assert.deepEqual(t.messages.map((m) => (m.arms ?? []).map((e) => e.slice(e.lastIndexOf(':') + 1)).join()), ['', 'b1', 'b2', '']);
  assert.deepEqual(viewOf(t, { detail: 'full' }).messages.map((m) => m.label), ['http:GET s/x', 'op1', 'op3']);
});

test('design alt frame (groups): a decision; nested alt is a child decision; unlabelled branches read "branch N"', () => {
  const t = run({ main: [leaf(1, { groups: [{ id: 'f', kind: 'alt', condition: 'paid' }] }), leaf(2, { groups: [{ id: 'f', kind: 'alt', condition: 'free' }, { id: 'g', kind: 'alt' }] }), leaf(3, { groups: [{ id: 'f', kind: 'alt', condition: 'free' }, { id: 'g', kind: 'alt', condition: 'x' }] })] });
  const [f, g] = t.decisions!;
  assert.equal(f.group_id, 'main:f');
  assert.deepEqual(f.arms.map((a) => a.label), ['paid', 'free']);
  assert.equal(g.group_id, 'main:g');
  assert.deepEqual(g.parent, { group_id: 'main:f', arm: 'b2' });
  assert.deepEqual(g.arms.map((a) => a.label), ['branch 1', 'x']);
});

test('opt, loop, par, critical and break are not choices', () => {
  for (const kind of ['opt', 'loop', 'par', 'critical', 'break']) {
    const t = run({ main: [leaf(1, { groups: [{ id: 'f', kind, condition: 'a' }] }), leaf(2, { groups: [{ id: 'f', kind, condition: 'b' }] })] });
    assert.equal(t.decisions, undefined, kind);
    assert.ok(t.messages.some((m) => m.alt?.kind === kind), 'the frame is still on the message');
  }
});

test('a flow without alt is returned untouched (no decisions, no keys added)', () => {
  const t = run({ main: [leaf(1), leaf(2)] });
  assert.equal(t.decisions, undefined);
  assert.ok(t.messages.every((m) => m.key === undefined && !m.arms));
});

test('no double counting: a group that hosts `alternatives` stays the one decision', () => {
  const G = { group_id: 'uuid-1', name: 'n', arms: [{ arm: 'x', step_ids: ['s:main#1'] }, { arm: 'y', step_ids: ['s:main#2'] }] };
  const t = run({ main: [leaf(1, { condition: 'c1', altGroup: 'k', alternatives: [G] }), leaf(2, { condition: 'c2', altGroup: 'k', alternatives: [G] })] });
  assert.deepEqual(t.decisions!.map((d) => d.group_id), ['uuid-1']);
  assert.ok(t.messages.every((m) => !m.arms?.some((e) => e.includes('main:k'))));
});

test('colons in the group id: choose=, ch= and arms entries split at the last colon', () => {
  assert.deepEqual(parseChoose('advance_erase:next-priority:b2'), { 'advance_erase:next-priority': 'b2' });
  assert.deepEqual(parseChoose('advance_erase:next-priority:both,3b1f0a52-7c1e:both,*:both,g:x:y'), { 'advance_erase:next-priority': 'both', '3b1f0a52-7c1e': 'both', '*': 'both', g: 'x:y' }, 'All of an alt group (QA 0.38.1); other arm names keep the first-colon split');
  const t = trace(buildIndex(sampleModel()), { service: 'account-lambda-erase-controller', ingress: 'in.advanceErase' }, { scope: 'full', maxMessages: 500 })!;
  const v = viewOf(t, { choose: parseChoose('advance_erase:next-priority:b3') });
  assert.equal(v.decisions![0].chosen, 'b3');
  assert.ok(v.messages.every((m) => !m.arms || m.arms.every((e) => e.endsWith(':b3'))));
  const ch = encodeChoose(t.decisions, new Map([['advance_erase:next-priority', 'b3']]));
  assert.equal(ch, 'advance_:b3');
  assert.deepEqual(applyChoose(t.decisions, decodeChoose(ch)).chosen, new Map([['advance_erase:next-priority', 'b3']]));
});

test('Mermaid of an alt decision on All (QA 0.38.1): one alt with its else lines, inside the loop that holds it; the choose=<group>:both text splits at the last colon', () => {
  const t = trace(buildIndex(sampleModel()), { service: 'account-lambda-erase-controller', ingress: 'in.advanceErase' }, { scope: 'full', maxMessages: 500 })!;
  const v = viewOf(t, { choose: parseChoose('advance_erase:next-priority:both') });
  assert.equal(v.decisions![0].chosen, 'both');
  const text = exportMermaid(v).split('\n');
  assert.equal(text.filter((l) => l.startsWith('alt ')).length, 1);
  assert.equal(text.filter((l) => l.startsWith('else ')).length, 3);
  assert.equal(text.filter((l) => l === 'end').length, text.filter((l) => /^(alt|loop|opt|par|critical|break|rect)\b/.test(l)).length, 'every frame closes');
});
