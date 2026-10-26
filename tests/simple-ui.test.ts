// 0.44.0 (#90): the pure parts of the Simple view's drawing: the lane (counted row, repeat marker, unfolded copies), step numbering, the Info pane texts, the detail preference and the URL.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { viewOf } from '../core/trace-view.ts';
import { stepKeys } from '../core/description.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { isStep } from '../web/js/views/flow-steps.js';
// @ts-ignore
import { repeatText } from '../web/js/views/flow-panel-simple.js';
// @ts-ignore
import { detailStored, detailSave } from '../web/js/views/flow-prefs.js';
// @ts-ignore
import { scenarioQuery, readQuery, decisionsTitle } from '../web/js/views/flow-scenario-pure.js';

const g = buildIndex(sampleModel());
const canon = (s: string, i: string) => trace(g, { service: s, ingress: i }, { scope: 'full', maxMessages: 800 })!;
const lane = (t: any) => buildLane(t.messages, { scope: t.scope, participants: t.participants, repeats: t.detail === 'simple' });

test('switch: Simple is the stored default, an old stored External stays External, the URL always carries the detail', () => {
  const store = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); } };
  assert.equal(detailStored(), 'simple');
  store.set('flow-mapper.detail', 'external');
  assert.equal(detailStored(), 'external');
  detailSave('full'); assert.equal(detailStored(), 'full');
  detailSave('simple'); assert.equal(detailStored(), 'simple');
  delete (globalThis as any).localStorage;
  assert.equal(scenarioQuery([], { chosen: new Map(), detail: 'simple', open: new Set(['a']) }).detail, 'simple');
  assert.equal(readQuery(new URLSearchParams('detail=simple')).detail, 'simple');
});

test('Simple lane: the counted row is a store arrow carrying its occurrences and #88 calls; the repeat is a thin arrow with no bar', () => {
  const v = viewOf(canon('profile-svc', 'in.updateProfile'), { detail: 'simple' });
  const l = lane(v);
  const stores = l.events.filter((e: any) => e.type === 'store');
  assert.deepEqual(stores.map((e: any) => e.msg.label), ['*3 get, set', '*3 findOne']);
  assert.equal(stores[0].msg.occurrences.length, 3);
  assert.equal(stores[0].msg.dbGroup.calls.length, 2);
  const rep = l.events.find((e: any) => e.repeat);
  assert.ok(rep && rep.type === 'call' && !rep.bar, 'a repeat marker draws no activation bar');
  assert.equal(rep.repeat, 5);
  assert.equal(l.bars.length, 3, 'profile-svc, mailer-svc, ledger-svc (first expansion)');
  assert.equal(v.participants.find((p: any) => p.id === 'svc:profile-svc').hiddenSteps, 5);
});

test('an unfolded repeat keeps its bar and the copies are not numbered steps', () => {
  const t = canon('roles-svc', 'in.removeUser');
  const keys = stepKeys(t.messages), at = t.messages.findIndex((m: any) => m.repeatOf);
  assert.ok(at > 0);
  const v = viewOf(t, { detail: 'full', unfold: [keys[at]] });
  const copies = v.messages.filter((m: any) => m.unfoldOf);
  assert.ok(copies.length > 0);
  assert.ok(copies.every((m: any) => m.unfoldOf.sub.startsWith(`${m.unfoldOf.marker}.`)));
  assert.equal(isStep({ type: 'icall', msg: copies[0] }), false);
  assert.equal(isStep({ type: 'icall', msg: v.messages[at] }), true);
  const l = buildLane(v.messages, { scope: 'full', participants: v.participants, icalls: true });
  assert.ok(l.events.filter((e: any) => e.type === 'icall').some((e: any) => e.msg.unfoldOf), 'a copy is drawn as a row');
  assert.ok(l.events.some((e: any) => e.repeat), 'the marker is still styled as a repeat');
});

test('Info pane text says what the repeat is, per kind (not "the same delivery" for a call)', () => {
  assert.match(repeatText({ kind: 'call' }), /function call \(same bound values\)/);
  assert.match(repeatText({ kind: 'egress' }), /same call \(same endpoint/);
  assert.match(repeatText({ kind: 'deliver' }), /same delivery \(consumer, ingress, event\)/);
});

test('Flows list: the decisions tooltip counts Simple when the stored detail is Simple', () => {
  const c = { decisions: 1, steps: 9, both: { min: 9, max: 11 }, full: 14, simple: 6 };
  assert.match(decisionsTitle(c, 'simple'), /shown together in Simple: 6 steps/);
  assert.match(decisionsTitle(c, 'external'), /default view: 9 steps/);
});
