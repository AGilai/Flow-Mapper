// 0.37.0 (#82): arms and locks in the canonical trace: `arms` on messages, `decisions`, nesting, fixes, the scoped repeat rule, the tally.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { stepKeys } from '../core/description.ts';
import { sampleModel } from './helpers.ts';

const G = (id: string, arms: Record<string, string[]>, extra: object = {}) => ({ group_id: id, name: `name of ${id}`, arms: Object.entries(arms).map(([arm, step_ids]) => ({ arm, label: `label ${arm}`, step_ids })), ...extra });
const leaf = (seq: number, extra: object = {}) => ({ seq, type: 'call', kind: 'leaf', operation: `op${seq}`, ...extra });
const call = (seq: number, target: string, extra: object = {}) => ({ seq, type: 'call', target, ...extra });
const svc = (name: string) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' });
/** service s (handler main) and, when `egress` is given, service t with an ingress that the egress `e` reaches. */
function run(fns: Record<string, any[]>, opts: object = {}, extra: { remote?: boolean } = {}) {
  const functions = Object.entries(fns).map(([id, steps]) => ({ service: 's', id, name: id, steps }));
  const model: any = { env: 't', services: [svc('s')], functions, ingress: [{ service: 's', id: 'in', bindKey: 'http:GET s/x', transport: 'http', handler: 'main' }], egress: [], resources: [], channels: [], bindings: [] };
  if (extra.remote) {
    model.services.push(svc('t'));
    model.functions.push({ service: 't', id: 'h', name: 'h', steps: [leaf(1)] });
    model.ingress.push({ service: 't', id: 'in.t', bindKey: 'http:GET t/x', transport: 'http', handler: 'h' });
    model.egress.push({ service: 's', id: 'e', bindKey: 'http:GET t/x', transport: 'http', mode: 'sync' });
  }
  return trace(buildIndex(model), { service: 's', ingress: 'in' }, { scope: 'full', ...opts })!;
}
const armsOf = (t: any) => t.messages.map((m: any) => `${m.label}=${(m.arms ?? []).join('+')}`);
const dec = (t: any, id: string) => t.decisions.find((d: any) => d.group_id === id);

// main#1 -> a (arm x of g1), main#2 -> b (arm y); a has a nested group g2 (a#1 arm p, a#2 arm q)
const nested = () => ({
  main: [call(1, 'a', { alternatives: [G('g1', { x: ['s:main#1'], y: ['s:main#2'] })] }), call(2, 'b', { alternatives: [G('g1', { x: ['s:main#1'], y: ['s:main#2'] })] })],
  a: [leaf(1, { alternatives: [G('g2', { p: ['s:a#1'], q: ['s:a#2'] }, { llm_name: 'Which one', depends_on: 'data', guard: { text: 'ok', file: 'a.js', line: 3 } })] }), leaf(2, { alternatives: [G('g2', { p: ['s:a#1'], q: ['s:a#2'] })] })],
  b: [leaf(1), leaf(2)],
});

test('arms: every message in an arm carries the path, outermost first; subtrees stay in their arm', () => {
  const t = run(nested());
  assert.deepEqual(armsOf(t), ['http:GET s/x=', 'a=g1:x', 'op1=g1:x+g2:p', 'op2=g1:x+g2:q', 'b=g1:y', 'op1=g1:y', 'op2=g1:y']);
});

test('decisions: first-seen order, names, labels, nesting, one entry per group', () => {
  const t = run(nested());
  assert.deepEqual(t.decisions!.map((d) => d.group_id), ['g1', 'g2']);
  const g2 = dec(t, 'g2');
  assert.equal(g2.name, 'Which one'); assert.equal(g2.template_name, 'name of g2'); assert.equal(g2.llm_name, 'Which one');
  assert.equal(g2.depends_on, 'data'); assert.deepEqual(g2.guard, { text: 'ok', file: 'a.js', line: 3 });
  assert.deepEqual(g2.parent, { group_id: 'g1', arm: 'x' });
  assert.equal(dec(t, 'g1').parent, undefined);
  assert.deepEqual(dec(t, 'g1').arms.map((a: any) => [a.arm, a.label]), [['x', 'label x'], ['y', 'label y']]);
  assert.equal(dec(t, 'g1').name, 'name of g1'); assert.equal(dec(t, 'g1').lock, undefined);
});

test('decisions: arm counts are messages per arm, nested arms as min-max, never summed', () => {
  const t = run(nested());
  assert.deepEqual(dec(t, 'g1').arms.map((a: any) => a.steps), [{ min: 2, max: 2 }, { min: 3, max: 3 }]);
  assert.deepEqual(dec(t, 'g2').arms.map((a: any) => a.steps), [{ min: 1, max: 1 }, { min: 1, max: 1 }]);
});

test('keys are stamped once over the full trace when there are decisions, and not otherwise', () => {
  const t = run(nested());
  assert.deepEqual(t.messages.map((m) => m.key), stepKeys(t.messages));
  assert.ok(t.messages.every((m) => m.key));
  const plain = run({ main: [leaf(1), leaf(2)] });
  assert.ok(!('decisions' in plain)); assert.ok(plain.messages.every((m) => !('key' in m) && !('arms' in m)));
});

test('a lock (fixes on the calling step) follows only the fixed arm below it, and is reported on the decision', () => {
  const fns: any = { top: [call(1, 'main', { fixes: [{ group_id: 'g1', arm: 'y', source: { file: 'r.js', line: 75 }, literal: 'k' }] })], ...nested() };
  const t = trace(buildIndex(mini(fns)), { service: 's', fn: 'top' }, { scope: 'full' })!;
  assert.deepEqual(armsOf(t), ['top=', 'main=', 'b=g1:y', 'op1=g1:y', 'op2=g1:y']);
  assert.deepEqual(dec(t, 'g1').lock, { arm: 'y', at: 's:top#1', source: { file: 'r.js', line: 75 }, literal: 'k' });
  assert.equal(dec(t, 'g1').lock_places, undefined);
  assert.equal(dec(t, 'g2'), undefined, 'the skipped arm holds the nested decision: never reached');
});
function mini(fns: Record<string, any[]>): any {
  return { env: 't', services: [svc('s')], functions: Object.entries(fns).map(([id, steps]) => ({ service: 's', id, name: id, steps })), ingress: [], egress: [], resources: [], channels: [], bindings: [] };
}

test('a lock is scoped to the path below the fixing call: a sibling call is not fixed, and the decision says "n of m"', () => {
  const pick = [leaf(1, { alternatives: [G('g', { x: ['s:pick#1'], y: ['s:pick#2'] })] }), leaf(2, { alternatives: [G('g', { x: ['s:pick#1'], y: ['s:pick#2'] })] })];
  const t = trace(buildIndex(mini({ top: [call(1, 'pick', { fixes: [{ group_id: 'g', arm: 'x' }] }), call(2, 'pick')], pick })), { service: 's', fn: 'top' }, { scope: 'full' })!;
  assert.deepEqual(armsOf(t), ['top=', 'pick=', 'op1=g:x', 'pick=', 'op1=g:x', 'op2=g:y']);
  assert.equal(dec(t, 'g').lock, undefined);
  assert.deepEqual(dec(t, 'g').lock_places, { fixed: 2, of: 4 });
});

test('a nearer fix wins over a farther one for the same group', () => {
  const fns = { top: [call(1, 'mid', { fixes: [{ group_id: 'g', arm: 'x' }] })], mid: [call(1, 'pick', { fixes: [{ group_id: 'g', arm: 'y' }] })],
    pick: [leaf(1, { alternatives: [G('g', { x: ['s:pick#1'], y: ['s:pick#2'] })] }), leaf(2)] };
  const t = trace(buildIndex(mini(fns)), { service: 's', fn: 'top' }, { scope: 'full' })!;
  assert.deepEqual(armsOf(t).slice(3), ['op2=g:y']);
  assert.equal(dec(t, 'g').lock.arm, 'y'); assert.equal(dec(t, 'g').lock.at, 's:mid#1');
});

test('the repeat rule (#43) is scoped: a delivery in an exclusive arm expands again, the same arm points back, outside-then-inside points back', () => {
  const grp = G('g', { x: ['s:main#1', 's:main#2'], y: ['s:main#3'] });
  const fns = { main: [call(1, 'fx', { alternatives: [grp] }), call(2, 'fx2', { alternatives: [grp] }), call(3, 'fy', { alternatives: [grp] }), call(4, 'fz')],
    fx: [{ seq: 1, type: 'egress', target: 'e' }], fx2: [{ seq: 1, type: 'egress', target: 'e' }], fy: [{ seq: 1, type: 'egress', target: 'e' }], fz: [{ seq: 1, type: 'egress', target: 'e' }] };
  const t = run(fns, {}, { remote: true });
  const deliveries = t.messages.filter((m) => m.kind === 'egress');
  assert.deepEqual(deliveries.map((m) => [m.arms?.join('+') ?? '', m.repeatOf ?? null]), [['g:x', null], ['g:x', t.messages.indexOf(deliveries[0]) + 1], ['g:y', null], ['', null]]);
  // x then x: repeat. y: its own expansion (arm x may be hidden), outside (no arm) again: neither may point into an arm
  assert.equal(t.messages.filter((m) => m.kind === 'leaf').length, 3);
});

test('maxMessages: only the largest arm counts, so choosing arms never truncates earlier than the largest scenario', () => {
  const fns = { main: [call(1, 'big', { alternatives: [G('g', { x: ['s:main#1'], y: ['s:main#2'] })] }), call(2, 'small', { alternatives: [G('g', { x: ['s:main#1'], y: ['s:main#2'] })] })],
    big: [leaf(1), leaf(2), leaf(3)], small: [leaf(1)] };
  // entry + (call + 3 leaves) = 5 counted; the small arm (call + 1 leaf) does not add
  assert.equal(run(fns, { maxMessages: 5 }).truncated, false);
  assert.equal(run(fns, { maxMessages: 4 }).truncated, true);
  assert.equal(run(fns, { maxMessages: 5 }).messages.length, 7);
});

test('a step the path already holds in another arm of the same group keeps the path arm', () => {
  const fns = { main: [call(1, 'a', { alternatives: [G('g', { x: ['s:main#1'], y: ['s:a#1'] })] })], a: [leaf(1)] };
  assert.deepEqual(armsOf(run(fns)), ['http:GET s/x=', 'a=g:x', 'op1=g:x']);
});

test('the sample: member-api in.register (nested decisions) and in.registerIdp (a lock)', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: 'member-api', ingress: 'in.register' }, { scope: 'full' })!;
  assert.equal(t.decisions!.length, 2);
  const [gm, ge] = t.decisions!;
  assert.deepEqual(gm.arms.map((a) => a.arm), ['createFromIdp', 'invite']);
  assert.deepEqual(ge.parent, { group_id: gm.group_id, arm: 'createFromIdp' });
  assert.deepEqual(ge.arms.map((a) => [a.arm, a.steps]), [['yes', { min: 3, max: 3 }], ['no', { min: 6, max: 6 }]]);
  assert.deepEqual(gm.arms.map((a) => a.steps), [{ min: 5, max: 8 }, { min: 4, max: 4 }]);
  const lk = trace(g, { service: 'member-api', ingress: 'in.registerIdp' }, { scope: 'full' })!;
  assert.deepEqual(lk.decisions![0].lock, { arm: 'createFromIdp', at: 'member-api:registerIdp#1', source: { file: 'routes/register.js', line: 75 }, literal: 'idp' });
  assert.ok(lk.messages.every((m) => !m.arms?.some((a) => a.endsWith(':invite'))));
});
