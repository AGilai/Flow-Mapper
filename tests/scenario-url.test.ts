// 0.38.3: the scenario in the URL survives a reload (the active tab's `ch=` is kept while its data loads), and edit mode of a design draft
// writes `ch=` against its own default (All). No DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import * as P from '../web/js/views/flow-scenario-pure.js';
// @ts-ignore
import { createScenarios } from '../web/js/views/flow-scenario-state.js';

const A = 'aaaaaaaa-1111', B = 'bbbbbbbb-2222';
const ds = [{ group_id: A, name: 'a', arms: [{ arm: 'x' }, { arm: 'y' }] }, { group_id: B, name: 'b', arms: [{ arm: 'p' }, { arm: 'q' }] }];

test('reload: the active tab writes its `ch=`, `detail=` and `open=` back before its data has arrived', () => {
  const q = new URLSearchParams('env=prod&tabs=member-api/in.register&ch=aaaaaaaa:y&detail=full&open=svc');
  const scen = createScenarios(q, 'prod|member-api/in.register', () => 'external');
  // persist() runs before any tab asked for its state: the `ch=` of the link must not be erased
  assert.equal(scen.query('prod|member-api/in.register').ch, 'aaaaaaaa:y');
  assert.equal(scen.query('prod|member-api/in.register').detail, 'full');
  assert.equal(scen.query('other').ch, null, 'another tab writes nothing');
});

test('reload: once resolved, the choice is written from the state', () => {
  const q = new URLSearchParams('ch=aaaaaaaa:y');
  const scen = createScenarios(q, 'k', () => 'external');
  const st = scen.of('k');
  const r = P.applyChoose(ds, P.decodeChoose(st.rawCh));
  Object.assign(st, { chosen: r.chosen, rawCh: null, resolved: true, decisions: ds });
  assert.equal(scen.query('k').ch, 'aaaaaaaa:y');
});
test('edit mode: All is the default, so only real choices are written', () => {
  const all = new Map([[A, 'both'], [B, 'both']]);
  assert.equal(P.encodeChoose(ds, all, true), null, 'every decision on All: nothing');
  assert.equal(P.changedCount(ds, all, true), 0);
  assert.equal(P.encodeChoose(ds, new Map([[A, 'x'], [B, 'both']]), true), 'aaaaaaaa:x', 'an explicit first arm is a choice here');
  assert.equal(P.changedCount(ds, new Map([[A, 'x'], [B, 'both']]), true), 1);
  assert.equal(P.encodeChoose(ds, all, false), 'aaaaaaaa:both,bbbbbbbb:both', 'outside edit mode All is a difference');
  const back = P.applyChoose(ds, P.decodeChoose('aaaaaaaa:x'), true);
  assert.equal(back.chosen.get(A), 'x', 'the link round-trips in edit mode');
});

test('edit mode: scenarioQuery follows the state flag', () => {
  const s = { chosen: new Map([[A, 'both']]), detail: 'external', open: new Set(), edit: true };
  assert.equal(P.scenarioQuery(ds, s).ch, null);
  assert.equal(P.scenarioQuery(ds, { ...s, edit: false }).ch, 'aaaaaaaa:both');
});
