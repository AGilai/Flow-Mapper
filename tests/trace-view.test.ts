// 0.37.1 (#82): viewOf: choose (first arm default, both, locks), detail external / full, open, DB-op grouping, renumbering, counts, keys.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { entryPoints, trace } from '../core/trace.ts';
import { viewOf } from '../core/trace-view.ts';
import { parseChoose, viewParams } from '../core/trace-view-params.ts';
import { stepKeys } from '../core/description.ts';
import { HASH_TRACE } from '../core/description.ts';
import { sampleModel } from './helpers.ts';

const G = (id: string, arms: Record<string, string[]>) => ({ group_id: id, name: `name ${id}`, arms: Object.entries(arms).map(([arm, step_ids]) => ({ arm, step_ids })) });
const leaf = (seq: number, extra: object = {}) => ({ seq, type: 'call', kind: 'leaf', operation: `op${seq}`, ...extra });
const call = (seq: number, target: string, extra: object = {}) => ({ seq, type: 'call', target, ...extra });
const res = (seq: number, target: string, op = 'find') => ({ seq, type: 'resource', target, operation: op });
const egress = (seq: number, extra: object = {}) => ({ seq, type: 'egress', target: 'e', ...extra });
const svc = (name: string) => ({ name, kind: 'service', version: 1, harvestedAt: '2026-01-01' });
const RES = [['r1', 'users'], ['r2', 'devices']].map(([id, c]) => ({ service: 's', id, kind: 'mongodb', name: c, bindKey: `mongodb:db/${c}` })).concat([{ service: 's', id: 'r3', kind: 'postgres', name: 'orders', bindKey: 'postgres:other/orders' }]);
/** service s (handler main), service t (handler h, one leaf) behind egress e (sync unless `mode`). */
function run(fns: Record<string, any[]>, opts: object = {}, mode: 'sync' | 'async' = 'sync') {
  const model: any = { env: 't', services: [svc('s'), svc('t')], functions: [...Object.entries(fns).map(([id, steps]) => ({ service: 's', id, name: id, steps })), { service: 't', id: 'h', name: 'h', steps: [leaf(1)] }],
    ingress: [{ service: 's', id: 'in', bindKey: 'http:GET s/x', transport: 'http', handler: 'main' }, { service: 't', id: 'in.t', bindKey: 'http:GET t/x', transport: 'http', handler: 'h' }],
    egress: [{ service: 's', id: 'e', bindKey: 'http:GET t/x', transport: 'http', mode }], resources: RES, channels: [], bindings: [] };
  return trace(buildIndex(model), { service: 's', ingress: 'in' }, { scope: 'full', ...opts })!;
}
const labels = (t: any) => t.messages.map((m: any) => m.label);
const nest = () => {
  const g1 = G('g1', { x: ['s:main#1'], y: ['s:main#2'] }), g2 = G('g2', { p: ['s:a#1'], q: ['s:a#2'] });
  return { main: [call(1, 'a', { alternatives: [g1] }), call(2, 'b', { alternatives: [g1] })], a: [leaf(1, { alternatives: [g2] }), leaf(2, { alternatives: [g2] })], b: [leaf(1), leaf(2), leaf(3)] };
};

test('choose: the default is the FIRST arm of each decision, nested ones included', () => {
  const v = viewOf(run(nest()), { detail: 'full' });
  assert.deepEqual(labels(v), ['http:GET s/x', 'a', 'op1']);
  assert.deepEqual(v.choose, { g1: 'x', g2: 'p' });
  assert.deepEqual(v.decisions!.map((d) => [d.group_id, d.chosen]), [['g1', 'x'], ['g2', 'p']]);
});

test('choose: an arm, both, and the wildcard; a nested decision is offered only under its parent arm', () => {
  const t = run(nest());
  assert.deepEqual(labels(viewOf(t, { detail: 'full', choose: { g1: 'y' } })), ['http:GET s/x', 'b', 'op1', 'op2', 'op3']);
  const y = viewOf(t, { detail: 'full', choose: { g1: 'y', g2: 'q' } });
  assert.deepEqual(y.decisions!.map((d) => d.group_id), ['g1'], 'g2 sits in arm x: not offered, its choice is forgotten');
  assert.deepEqual(y.choose, { g1: 'y' });
  assert.equal(viewOf(t, { detail: 'full', choose: { g1: 'both' } }).messages.length, 7, 'both arms of g1, g2 on its first arm');
  assert.deepEqual(labels(viewOf(t, { detail: 'full', choose: { g1: 'x', g2: 'q' } })), ['http:GET s/x', 'a', 'op2']);
  assert.equal(viewOf(t, { detail: 'full', choose: new Map([['*', 'both']]) }).messages.length, 8, 'wildcard: both everywhere');
  assert.deepEqual(viewOf(t, { detail: 'full', choose: { '*': 'both', g1: 'y' } }).choose, { g1: 'y' });
});

test('choose: unknown group or arm is a warning and is ignored; a lock wins over a conflicting choice', () => {
  const t = run(nest());
  const v = viewOf(t, { detail: 'full', choose: { nope: 'x', g1: 'zzz' } });
  assert.deepEqual(v.warnings, ['nope: not a decision of this flow', "g1: no arm 'zzz'"]);
  assert.deepEqual(v.choose, { g1: 'x', g2: 'p' });
  const fns: any = { top: [call(1, 'main', { fixes: [{ group_id: 'g1', arm: 'y' }] })], ...nest() };
  const model: any = { env: 't', services: [svc('s')], functions: Object.entries(fns).map(([id, steps]) => ({ service: 's', id, name: id, steps })), ingress: [], egress: [], resources: [], channels: [], bindings: [] };
  const lk = trace(buildIndex(model), { service: 's', fn: 'top' }, { scope: 'full' })!;
  const w = viewOf(lk, { detail: 'full', choose: { g1: 'x' } });
  assert.deepEqual(w.warnings, ['g1: locked to y']);
  assert.deepEqual(w.choose, { g1: 'y' });
  assert.ok(w.messages.some((m) => m.label === 'b'));
  assert.equal(viewOf(lk, { detail: 'full', choose: { g1: 'both' } }).choose!.g1, 'y', 'even "both" stays on the locked arm');
});

test('detail: external keeps ingress, calls out, deliveries, DB ops and problems; full keeps everything', () => {
  const t = run({ main: [call(1, 'a'), leaf(2), res(3, 'r1'), egress(4), { seq: 5, type: 'call', target: 'gone' }], a: [leaf(1), res(2, 'r2')] });
  const ext = viewOf(t, { detail: 'external', group: false });
  assert.deepEqual(ext.messages.map((m) => m.kind), ['entry', 'resource', 'resource', 'egress']);
  assert.equal(viewOf(t, { detail: 'full' }), t, 'full of a trace without decisions: the trace itself');
  assert.equal(viewOf(t, { detail: 'full' }).messages.length, t.messages.length);
  assert.equal(ext.detail, 'external');
  assert.equal(viewOf(t).detail, 'external', 'external is the default');
});

test('detail: an arm that would show nothing keeps its outcome (a leaf), else its first message', () => {
  const g = G('g', { ok: ['s:main#1'], bad: ['s:main#2'] });
  const t = run({ main: [call(1, 'fine', { alternatives: [g] }), call(2, 'reject', { alternatives: [g] })], fine: [egress(1)], reject: [leaf(1, { operation: 'reject 422' })] });
  const both = viewOf(t, { detail: 'external', choose: { g: 'both' } });
  assert.deepEqual(labels(both), ['http:GET s/x', 'http:GET t/x', 'reject 422'], 'the call into reject is hidden, its only content stays');
  assert.deepEqual(labels(viewOf(t, { detail: 'external', choose: { g: 'bad' } })), ['http:GET s/x', 'reject 422']);
  const t2 = run({ main: [call(1, 'fine', { alternatives: [G('g', { a: ['s:main#1'], b: ['s:main#2'] })] }), call(2, 'other', { alternatives: [G('g', { a: ['s:main#1'], b: ['s:main#2'] })] })], fine: [egress(1)], other: [call(1, 'deep')], deep: [] });
  assert.deepEqual(labels(viewOf(t2, { detail: 'external', choose: { g: 'b' } })), ['http:GET s/x', 'other']);
});

test('open: brings back the internal calls of a service, or of one function', () => {
  const t = run({ main: [call(1, 'a'), call(2, 'b'), egress(3)], a: [leaf(1)], b: [leaf(1), leaf(2)] });
  assert.deepEqual(labels(viewOf(t, { detail: 'external' })), ['http:GET s/x', 'http:GET t/x']);
  assert.equal(viewOf(t, { detail: 'external', open: ['s'] }).messages.length, t.messages.length - 1, 'all of s (the leaf of t stays hidden)');
  assert.deepEqual(labels(viewOf(t, { detail: 'external', open: ['s:b'] })), ['http:GET s/x', 'b', 'op1', 'op2', 'http:GET t/x']);
  assert.deepEqual(labels(viewOf(t, { detail: 'external', open: ['t'] })), ['http:GET s/x', 'http:GET t/x', 'op1']);
});

test('DB grouping: consecutive ops of one store are one row; the label lists the collections', () => {
  const t = run({ main: [res(1, 'r1'), res(2, 'r2', 'insert'), res(3, 'r1', 'update')] });
  const v = viewOf(t);
  assert.equal(v.messages.length, 2);
  const row = v.messages[1];
  assert.equal(row.label, 'DB: 3 ops (users, devices)');
  assert.deepEqual([row.dbGroup!.count, row.dbGroup!.collections, row.dbGroup!.access], [3, ['users', 'devices'], 'read_write']);
  assert.deepEqual(row.dbGroup!.members, stepKeys(t.messages).slice(1));
  assert.equal(row.key, stepKeys(t.messages)[1], 'the row takes its first member\'s key');
  assert.equal(viewOf(t, { detail: 'full' }), t, 'full view: not grouped by default (the page keeps drawing every op)');
  assert.equal(viewOf(t, { detail: 'full', group: true }).messages.length, 2);
});

test('DB grouping: a different store, an external call, a visible internal call, or an expanded run breaks it; one op is not a group', () => {
  const t = run({ main: [res(1, 'r1'), res(2, 'r2'), res(3, 'r3'), res(4, 'r1'), egress(5), res(6, 'r1'), res(7, 'r2'), call(8, 'a'), res(9, 'r1')], a: [res(1, 'r2')] });
  const ext = viewOf(t);
  assert.deepEqual(ext.messages.map((m) => m.dbGroup?.count ?? 1), [1, 2, 1, 1, 1, 4], 'r1/r2 then r3 (other store) then r1 alone then the egress; internal calls are hidden so the last ops merge across functions');
  const full = viewOf(t, { detail: 'full', group: true });
  assert.deepEqual(full.messages.map((m) => m.kind + (m.dbGroup?.count ?? '')), ['entry', 'resource2', 'resource', 'resource', 'egress', 'leaf', 'resource2', 'call', 'resource2'], 'in the full view the call to `a` breaks the run; what follows it merges');
  const open = viewOf(t, { dbOpen: [stepKeys(t.messages)[1]] });
  assert.equal(open.messages.filter((m) => m.dbGroup).length, 1, 'the run at that key stays expanded');
});

test('DB grouping: ops of different arms or of deferred work are not merged', () => {
  const g = G('g', { x: ['s:main#1'], y: ['s:main#2'] });
  const t = run({ main: [call(1, 'fx', { alternatives: [g] }), call(2, 'fy', { alternatives: [g] })], fx: [res(1, 'r1'), res(2, 'r2')], fy: [res(1, 'r1'), res(2, 'r2')] });
  const v = viewOf(t, { choose: { g: 'both' } });
  assert.deepEqual(v.messages.map((m) => [m.dbGroup?.count ?? 1, (m.arms ?? []).join()]), [[1, ''], [2, 'g:x'], [2, 'g:y']]);
  const async = run({ main: [res(1, 'r1'), call(2, 'a', { mode: 'async' }), res(3, 'r2'), res(4, 'r1')], a: [res(1, 'r1'), res(2, 'r2')] });
  assert.deepEqual(viewOf(async).messages.filter((m) => m.dbGroup).map((m) => m.dbGroup!.count), [3, 2], 'what the async call does has its own `of`: it is not merged with the caller\'s ops');
});

test('renumbering: n, of and the labels follow the kept list after an arm is dropped', () => {
  const g = G('g', { x: ['s:main#1'], y: ['s:main#2'] });
  const t = run({ main: [call(1, 'fx', { alternatives: [g] }), call(2, 'fy', { alternatives: [g] })], fx: [leaf(1), egress(2)], fy: [leaf(1), egress(2)] }, {}, 'async');
  assert.deepEqual(t.messages.filter((m) => m.n).map((m) => m.n), [4, 8]);
  const y = viewOf(t, { detail: 'full', choose: { g: 'y' } });
  assert.deepEqual(y.messages.map((m) => [m.label, m.n ?? null, m.of ?? null]), [['http:GET s/x', null, null], ['fy', null, null], ['op1', null, null], ['http:GET t/x', 4, null], ['op1', null, 4]]);
  const ext = viewOf(t, { detail: 'external', choose: { g: 'both' } });
  assert.deepEqual(ext.messages.map((m) => [m.n ?? null, m.of ?? null]), [[null, null], [2, null], [3, null]]);
  assert.deepEqual(ext.messages.map((m) => m.kind), ['entry', 'egress', 'egress']);
});

test('renumbering: a repeat points at the first expansion by its new number, in the label too', () => {
  const g = G('g', { x: ['s:main#1', 's:main#2'] });
  const t = run({ main: [call(1, 'f', { alternatives: [g] }), call(2, 'f2', { alternatives: [G('g', { x: ['s:main#1', 's:main#2'], y: ['s:main#3'] })] }), call(3, 'z')], f: [egress(1)], f2: [egress(1)], z: [] });
  const rep = t.messages.find((m) => m.repeatOf)!;
  assert.match(rep.label, /seen at step 3$/);
  const ext = viewOf(t, { detail: 'external', choose: { '*': 'both' } });
  const r = ext.messages.find((m) => m.repeatOf)!;
  assert.equal(r.repeatOf, 2);
  assert.match(r.label, /seen at step 2$/);
});

test('renumbering keeps every trace of the samples consistent in every view', () => {
  const g = buildIndex(sampleModel());
  let n = 0;
  for (const e of entryPoints(g)) {
    const t = trace(g, { service: e.service, ingress: e.id }, HASH_TRACE);
    if (!t) continue;
    for (const v of [viewOf(t), viewOf(t, { detail: 'full', choose: { '*': 'both' } }), viewOf(t, { detail: 'external', choose: { '*': 'both' }, group: false })]) {
      v.messages.forEach((m, i) => {
        if (m.of !== undefined) assert.equal(v.messages[m.of - 1].n, m.of, `${e.id}: of ${m.of} at ${i}`);
        if (m.n !== undefined) assert.equal(v.messages[m.n - 1], m);
        if (m.repeatOf !== undefined) assert.match(m.label, new RegExp(`seen at step ${m.repeatOf}$`));
        if (m.group) assert.ok(v.messages[Number(m.group.slice(1))].deliveries, `${e.id}: group ${m.group}`);
      });
      const used = new Set(v.messages.flatMap((m) => [m.from, m.to]));
      assert.ok(v.participants.every((p) => used.has(p.id)));
      n++;
    }
  }
  assert.ok(n > 150);
});

test('counts: exact when every decision is on one arm, min-max only where both is chosen', () => {
  const t = run(nest());
  const one = viewOf(t, { detail: 'full' });
  assert.deepEqual(one.counts!.messages, { min: 3, max: 3 });
  const both = viewOf(t, { detail: 'full', choose: { g1: 'both' } });
  assert.deepEqual(both.counts!.messages, { min: 3, max: 5 }, 'entry + x (a and one of op1/op2 = 2) or y (b and 3 ops = 4)');
});

test('counts: nested decisions and arm ranges in the view; a count never sums the arms', () => {
  const t = run(nest());
  const v = viewOf(t, { detail: 'full', choose: { '*': 'both' } });
  assert.deepEqual(v.counts!.messages, { min: 3, max: 5 });
  assert.equal(v.messages.length, 8, 'eight messages are drawn, the count is 3 to 5 per scenario');
  const g1 = v.decisions!.find((d) => d.group_id === 'g1')!;
  assert.deepEqual(g1.arms.map((a) => a.steps), [{ min: 2, max: 2 }, { min: 4, max: 4 }]);
  assert.deepEqual(viewOf(t, { detail: 'full', choose: { g1: 'y' } }).counts!.messages, { min: 5, max: 5 });
});

test('keys: a view copies the canonical keys, ~N repeats are counted over the whole trace', () => {
  const t = run({ main: [res(1, 'r1'), call(2, 'a'), res(3, 'r1')], a: [leaf(1)] });
  const keys = stepKeys(t.messages);
  assert.ok(!keys[1].endsWith('~2') && keys[4].endsWith('~2'), 'the second identical op is ~2');
  const ext = viewOf(t, { group: false });
  assert.deepEqual(ext.messages.map((m) => m.key), [keys[0], keys[1], keys[4]], 'hiding the call keeps ~2 on the second op');
  const tn = run(nest()), y = viewOf(tn, { detail: 'full', choose: { g1: 'y' } });
  assert.deepEqual(y.messages.map((m) => m.key), [0, 4, 5, 6, 7].map((i) => tn.messages[i].key), 'choosing an arm never re-keys');
});

test('a view of a view is one view; the canonical trace is never changed', () => {
  const t = run(nest());
  const before = JSON.stringify(t);
  const v = viewOf(t, { detail: 'full', choose: { g1: 'y' } });
  assert.equal(JSON.stringify(t), before);
  assert.deepEqual(viewOf(v, { detail: 'full', choose: { g1: 'y' } }).messages, v.messages);
});

test('viewParams: strings, objects, defaults and a bad detail', () => {
  assert.deepEqual(parseChoose('g1:x,g2:a:b,'), { g1: 'x', g2: 'a:b' });
  assert.deepEqual(parseChoose({ g: 'x' }), { g: 'x' });
  assert.deepEqual(viewParams({}), { detail: 'external', choose: {}, open: [], dbOpen: [] });
  assert.deepEqual(viewParams({ detail: 'full', choose: '*:both', open: 'a,a:b', dbOpen: ['k'], group: '1' }), { detail: 'full', choose: { '*': 'both' }, open: ['a', 'a:b'], dbOpen: ['k'], group: true });
  assert.throws(() => viewParams({ detail: 'big' }), /external or full/);
  assert.throws(() => viewParams({ choose: 'garbage' }), /not <group>:<arm>/);
  assert.throws(() => viewParams({ choose: 'g:' }), /not <group>:<arm>/);
  assert.throws(() => viewParams({ choose: { g: 3 } }), /non-empty string/);
  assert.throws(() => viewParams({ choose: 5 }), /choose must be/);
  assert.throws(() => viewParams({ group: 'banana' }), /group must be/);
});

test('scope intra ignores detail (its lifelines are the functions)', () => {
  const t = run({ main: [call(1, 'a'), leaf(2)], a: [leaf(1)] }, { scope: 'intra' });
  assert.equal(viewOf(t, { detail: 'external', group: false }), t);
});
