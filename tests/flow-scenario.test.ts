// 0.38.0 (#82 part 3): the pure rules of the scenario UI (web/js/views/flow-scenario-pure.js): `ch=` encode / decode, the diff against the
// defaults, nested decisions, hidden steps and "Show" -> the arm that holds the step. No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import * as P from '../web/js/views/flow-scenario-pure.js';

const A = '3b1f0a52-7c1e-5d1a-8a34-5e0c4f6b2d10', B = '3b1f0a52-7c1e-5d1a-8a34-5e0c4f6b2d11', C = '9f2c1a7e-0000-5000-8000-000000000001';
const decisions = [
  { group_id: A, name: 'How the member joins', arms: [{ arm: 'createFromIdp' }, { arm: 'invite' }] },
  { group_id: B, name: 'User exists?', parent: { group_id: A, arm: 'createFromIdp' }, arms: [{ arm: 'yes' }, { arm: 'no' }] },
  { group_id: C, name: 'Locked one', lock: { arm: 'then' }, arms: [{ arm: 'then' }, { arm: 'else' }] },
];
const none = new Map();

test('ch=: nothing differs from the defaults, nothing in the URL', () => {
  assert.equal(P.encodeChoose(decisions, none), null);
  assert.equal(P.encodeChoose(decisions, new Map([[A, 'createFromIdp'], [B, 'yes']])), null, 'an explicit default is not a difference');
  assert.equal(P.changedCount(decisions, none), 0);
});

test('ch=: only the differing choices, by the first 8 characters of the group id', () => {
  const d = [{ group_id: 'aaaaaaaa-1111', arms: [{ arm: 'x' }, { arm: 'y' }] }, { group_id: 'bbbbbbbb-2222', arms: [{ arm: 'p' }, { arm: 'q' }] }];
  assert.equal(P.encodeChoose(d, new Map([['aaaaaaaa-1111', 'y']])), 'aaaaaaaa:y');
  assert.equal(P.encodeChoose(d, new Map([['aaaaaaaa-1111', 'both'], ['bbbbbbbb-2222', 'q']])), 'aaaaaaaa:both,bbbbbbbb:q');
});

test('ch=: ids that share their first 8 characters get a longer prefix, and it decodes back', () => {
  const ids = P.shortIds(decisions);
  assert.equal(ids.get(A).length > 8, true);
  assert.notEqual(ids.get(A), ids.get(B));
  const text = P.encodeChoose(decisions, new Map([[A, 'both'], [B, 'no']]))!;
  const { chosen, dropped } = P.applyChoose(decisions, P.decodeChoose(text));
  assert.equal(dropped, 0);
  assert.deepEqual([...chosen], [[A, 'both'], [B, 'no']]);
});

test('ch=: arm names with a comma or a colon survive the round trip', () => {
  const d = [{ group_id: 'aaaaaaaa-1', arms: [{ arm: 'x' }, { arm: 'a,b:c' }] }];
  const text = P.encodeChoose(d, new Map([['aaaaaaaa-1', 'a,b:c']]))!;
  assert.equal(text.includes(',') || text.split(':').length > 2, false);
  assert.equal(P.applyChoose(d, P.decodeChoose(text)).chosen.get('aaaaaaaa-1'), 'a,b:c');
});

test('ch=: unknown groups and arms are dropped and counted; malformed entries are skipped', () => {
  const dec = P.decodeChoose('3b1f0a52:nope,deadbeef:x,junk,:x,3b1f0a52:');
  assert.equal(dec.length, 2);
  const r = P.applyChoose(decisions, dec);
  assert.equal(r.chosen.size, 0);
  assert.equal(r.dropped, 2);
});

test('a lock is never a choice and never in the URL', () => {
  assert.equal(P.encodeChoose(decisions, new Map([[C, 'else']])), null);
  assert.equal(P.armIn(decisions[2], new Map([[C, 'else']])), 'then');
  assert.equal(P.applyChoose(decisions, P.decodeChoose(`${C.slice(0, 8)}:else`)).chosen.size, 0);
});

test('a nested decision is offered only while its parent arm is visible, and its choice is forgotten with it', () => {
  assert.deepEqual([...P.offeredSet(decisions, none)].sort(), [A, B, C].sort());
  assert.equal(P.offeredSet(decisions, new Map([[A, 'invite']])).has(B), false);
  assert.equal(P.offeredSet(decisions, new Map([[A, 'both']])).has(B), true);
  const c1 = P.setChoice(decisions, none, B, 'no');
  assert.equal(c1.get(B), 'no');
  const c2 = P.setChoice(decisions, c1, A, 'invite');
  assert.equal(c2.has(B), false, 'the nested choice goes when its parent arm is not visible');
  assert.equal(P.encodeChoose(decisions, c2), '3b1f0a52:invite'.replace('3b1f0a52', P.shortIds(decisions).get(A)));
});

test('the query of a tab: ch, detail=full and open only when set', () => {
  const s = (o: object) => ({ chosen: none, detail: 'external', open: new Set(), ...o });
  assert.deepEqual(P.scenarioQuery(decisions, s({})), { ch: null, detail: null, open: null });
  assert.deepEqual(P.scenarioQuery(decisions, s({ detail: 'full', open: new Set(['a', 'b:fn']) })), { ch: null, detail: 'full', open: null }, 'Full loads everything: no open=');
  assert.deepEqual(P.scenarioQuery(decisions, s({ open: new Set(['a', 'b:fn']) })), { ch: null, detail: null, open: 'a,b:fn' });
  const q = P.readQuery(new URLSearchParams('detail=full&open=x,y&ch=3b1f0a52:invite'));
  assert.equal(q.detail, 'full'); assert.deepEqual([...q.open], ['x', 'y']); assert.equal(q.decoded.length, 1);
  assert.equal(P.readQuery(new URLSearchParams('detail=zzz')).detail, null);
});

const canon = [
  { key: 'k0', arms: undefined },
  { key: 'k1', arms: [`${A}:createFromIdp`] },
  { key: 'k2', arms: [`${A}:createFromIdp`, `${B}:yes`] },
  { key: 'k3', arms: [`${A}:createFromIdp`, `${B}:no`] },
  { key: 'k4', arms: [`${A}:invite`] },
  { key: 'k5', arms: [`${C}:else`] },
];

test('hidden steps: a step on an arm that is not in force is hidden, one that is shown is not', () => {
  assert.equal(P.hiddenByArm(decisions, none, canon, 'k0'), null);
  assert.equal(P.hiddenByArm(decisions, none, canon, 'k1'), null);
  assert.equal(P.hiddenByArm(decisions, none, canon, 'k2'), null);
  assert.ok(P.hiddenByArm(decisions, none, canon, 'k3'));
  assert.ok(P.hiddenByArm(decisions, none, canon, 'k4'));
  assert.equal(P.hiddenByArm(decisions, new Map([[A, 'both']]), canon, 'k4'), null, 'both shows every arm');
  assert.equal(P.hiddenByArm(decisions, none, canon, 'no such key'), null, 'unknown here: not hidden by an arm');
});

test('Show: the choices that put every decision on the step\'s path on the step\'s arm', () => {
  const h = P.hiddenByArm(decisions, none, canon, 'k3');
  const c = P.showChoices(decisions, none, h)!;
  assert.equal(c.has(A), false, 'createFromIdp is the default, so nothing to record');
  assert.equal(c.get(B), 'no');
  const h2 = P.hiddenByArm(decisions, none, canon, 'k4');
  assert.equal(P.showChoices(decisions, none, h2)!.get(A), 'invite');
  const after = P.showChoices(decisions, none, h2)!;
  assert.equal(P.hiddenByArm(decisions, after, canon, 'k4'), null, 'the step is shown after Show');
});

test('Show: a step on the other arm of a locked decision cannot be shown', () => {
  const h = P.hiddenByArm(decisions, none, canon, 'k5')!;
  assert.equal(h.locked, true);
  assert.equal(P.showChoices(decisions, none, h), null);
});

test('counts read exact, or min-max with "per path"', () => {
  assert.equal(P.stepsText({ messages: { min: 6, max: 6 } }), '6 steps');
  assert.equal(P.stepsText({ messages: { min: 1, max: 1 } }), '1 step');
  assert.equal(P.stepsText({ messages: { min: 6, max: 7 } }), '6–7 steps');
  assert.equal(P.stepsText({ messages: { min: 6, max: 7 } }, true), '6–7 steps per path');
  assert.equal(P.stepsText(undefined), '');
});

test('a collapsed DB group stands for its members', () => {
  const steps = [{ n: 1, key: 'a' }, { n: 2, key: 'm1', keys: ['m1', 'm2', 'm3'] }];
  assert.equal(P.stepOfKey(steps, 'm3')?.n, 2);
  assert.equal(P.stepOfKey(steps, 'zz'), null);
});
