// Diff of items (QA D1-D4, D7, D8, D12): which anchors get which mark, what the phrase says, and what is noise.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diff, marksOf, mini, mut, row, without, withRow } from './diff-helpers.ts';

const base = mini();

test('D12 identical sides: no marks; key order and array-of-objects order of keys do not matter', () => {
  assert.deepEqual(diff(base, mini()).marks, {});
  const shuffled = mini().map((r) => ({ ...r, data: Object.fromEntries(Object.entries(r.data).reverse()) }));
  assert.deepEqual(diff(base, shuffled).marks, {});
  assert.equal(diff(base, mini()).counts.components.unchanged, 2);
});

test('D1 a new component: only svc: is marked, its children carry nothing', () => {
  const cur = [...mini(),
    { service: 'pop-edge', list: 'header', key: '', data: { kind: 'service', groupPath: 'network' } },
    { service: 'pop-edge', list: 'ingress', key: 'in.t', data: { id: 'in.t', transport: 'socket', bindKey: 'socket:tls/pop-edge/t', handler: 'H' } },
    { service: 'pop-edge', list: 'functions', key: 'H', data: { id: 'H', name: 'H', steps: [] } },
    { service: 'pop-edge', list: 'dto', key: 'in.t|request|', data: { content: { a: 1 }, meta: null } }];
  const m = diff(base, cur);
  // 0.28: the subsystem 'network' now carries a mark too (every component in it is new), see diff-subsystems.test.ts
  assert.deepEqual(marksOf(m), { 'grp:network': 'new', 'svc:pop-edge': 'new' });
  assert.equal(m.counts.components.new, 1);
  assert.equal(m.counts.endpoints.new, 0);
});

test('D1 a new endpoint on a copied component: ing: new, svc: changed "+1 endpoint"', () => {
  const cur = withRow(mini(), { service: 'auth-svc', list: 'ingress', key: 'in.token.device', data: { id: 'in.token.device', transport: 'http', bindKey: 'http:POST auth-svc/token/device', handler: 'Token.issue' } });
  const m = diff(base, cur);
  assert.deepEqual(marksOf(m), { 'ing:auth-svc/in.token.device': 'new', 'svc:auth-svc': 'changed' });
  assert.equal(m.marks['svc:auth-svc'].what, '+1 endpoint');
  assert.deepEqual([m.counts.components.changed, m.counts.endpoints.new], [1, 1]);
});

test('D1/D3 removed egress: removed mark, a ghost, svc: changed "−1 call"', () => {
  const m = diff(base, without(mini(), 'users-svc', 'egress', 'out.auth.token'));
  assert.equal(m.marks['egr:users-svc/out.auth.token'].mark, 'removed');
  assert.deepEqual(m.ghosts['egr:users-svc/out.auth.token'], { label: 'out.auth.token', service: 'users-svc', type: 'egress' });
  assert.equal(m.marks['svc:users-svc'].what, '−1 call');
});

test('D3 a new call names its callee (+1 call: x)', () => {
  const cur = withRow(mini(), { service: 'users-svc', list: 'egress', key: 'out.new', data: { id: 'out.new', transport: 'http', bindKey: 'http:GET auth-svc/x' } });
  const m = diff(base, cur, { calleeOf: (s, id) => (s === 'users-svc' && id === 'out.new' ? 'auth-svc' : undefined) });
  assert.equal(m.marks['svc:users-svc'].what, '+1 call: auth-svc');
});

test('D2/D3 changed transport, bindKey and handler are changed; undecided <-> http too', () => {
  for (const [list, key, field, value] of [['ingress', 'in.getUser', 'transport', 'grpc'], ['egress', 'out.auth.token', 'bindKey', 'http:POST auth-svc/tok'],
    ['ingress', 'in.getUser', 'handler', 'Other'], ['egress', 'out.auth.token', 'transport', 'undecided']]) {
    const m = diff(base, mut(mini(), 'users-svc', list, key, (d) => { d[field] = value; }));
    const a = `${list === 'ingress' ? 'ing' : 'egr'}:users-svc/${key}`;
    assert.equal(m.marks[a].mark, 'changed', a + field);
    assert.match(m.marks[a].what!, new RegExp(field));
    assert.equal(m.marks['svc:users-svc'].mark, 'changed');
  }
  const m = diff(base, mut(mini(), 'users-svc', 'egress', 'out.auth.token', (d) => { d.transport = 'undecided'; }));
  assert.equal(m.marks['egr:users-svc/out.auth.token'].was, 'was http');
});

test('D4 channel and binding changes roll up to the declaring component', () => {
  const m = diff(base, mut(mini(), 'users-svc', 'channels', 'sns:user-events', (d) => { d.kind = 'other'; }));
  assert.equal(m.marks['ch:sns:user-events'].mark, 'changed');
  assert.equal(m.marks['svc:users-svc'].what, '~1 channel');
  const removed = diff(base, without(mini(), 'users-svc', 'channels', 'sns:user-events'));
  assert.equal(removed.marks['ch:sns:user-events'].mark, 'removed');
  assert.equal(removed.counts.channels.removed, 1);
});

test('noise: provenance, source, groupPath, version, details.doc only -> no mark', () => {
  const cur = mini();
  row(cur, 'users-svc', 'ingress', 'in.getUser').data.provenance = { producer: 'hld-import' };
  row(cur, 'users-svc', 'ingress', 'in.getUser').data.source = { file: 'a.ts', line: 3 };
  row(cur, 'users-svc', 'egress', 'out.pub').data.details = { doc: { file: 'x.md', quote: 'q' } };
  Object.assign(row(cur, 'users-svc', 'header', '').data, { groupPath: 'other', version: 9, harvestedAt: 'later', commit: 'abc', details: { doc: 1 } });
  row(cur, 'users-svc', 'functions', 'UserCtl.get').data.steps[0].source = { file: 'z.ts' };
  // 0.28: a component that changes subsystem marks the subsystem it moved into (and no svc: or item mark)
  const m = diff(base, cur).marks;
  assert.deepEqual(Object.keys(m).filter((a) => !a.startsWith('grp:')), []);
  assert.equal(m['grp:other'].what, 'moved in: users-svc');
});

test('header change: svc: changed "header: team, description"', () => {
  const m = diff(base, mut(mini(), 'users-svc', 'header', '', (d) => { d.team = 'x'; d.description = 'y'; }));
  assert.equal(m.marks['svc:users-svc'].what, 'header: description, team');
});

test('D8 a key rename is removed + added, never changed', () => {
  const cur = mini();
  const r = row(cur, 'users-svc', 'egress', 'out.auth.token');
  r.key = 'out.auth.tokens'; r.data.id = 'out.auth.tokens';
  const m = marksOf(diff(base, cur));
  assert.equal(m['egr:users-svc/out.auth.token'], 'removed');
  assert.equal(m['egr:users-svc/out.auth.tokens'], 'new');
});

test('step inserted mid-function: one added step, the function is changed, nothing else', () => {
  const cur = mut(mini(), 'users-svc', 'functions', 'UserCtl.get', (d) => {
    d.steps = [d.steps[0], { seq: 2, type: 'egress', target: 'out.pub', operation: 'publish' }, { ...d.steps[1], seq: 3 }];
  });
  const m = diff(base, cur);
  assert.equal(m.marks['fn:users-svc/UserCtl.get'].what, '+1 step: out.pub');
  assert.deepEqual(Object.keys(m.marks).sort(), ['fn:users-svc/UserCtl.get', 'grp:platform', 'svc:users-svc']);   // 0.28: and the subsystem of the changed component
  assert.equal(m.marks['grp:platform'].what, '1 changed component');
  assert.equal(m.marks['svc:users-svc'].what, '~1 function');
});

test('renumbered steps alone (same content and order) are no change; a removed step is', () => {
  const cur = mut(mini(), 'users-svc', 'functions', 'UserCtl.get', (d) => { d.steps.forEach((s: any, i: number) => { s.seq = (i + 1) * 10; }); });
  assert.deepEqual(diff(base, cur).marks, {});
  const less = mut(mini(), 'users-svc', 'functions', 'UserCtl.get', (d) => { d.steps.pop(); });
  assert.equal(diff(base, less).marks['fn:users-svc/UserCtl.get'].what, '−1 step: res.db');
});

test('removing a whole component: svc: removed with a ghost, its children are pruned', () => {
  const cur = mini().filter((r) => r.service !== 'auth-svc');
  const m = diff(base, cur);
  assert.deepEqual(marksOf(m), { 'svc:auth-svc': 'removed' });
  assert.deepEqual(Object.keys(m.ghosts), ['svc:auth-svc']);
});

test('more than three phrases are cut: "+N more"', () => {
  const cur = mini();
  cur.push({ service: 'auth-svc', list: 'ingress', key: 'i2', data: { id: 'i2', transport: 'http', bindKey: 'http:GET auth-svc/2', handler: 'Token.issue' } },
    { service: 'auth-svc', list: 'egress', key: 'e2', data: { id: 'e2', transport: 'http', bindKey: 'http:GET x/2' } },
    { service: 'auth-svc', list: 'resources', key: 'r2', data: { id: 'r2', kind: 'redis', name: 'r' } },
    { service: 'auth-svc', list: 'channels', key: 'sns:c2', data: { bindKey: 'sns:c2', kind: 'sns-topic' } });
  const w = diff(base, cur).marks['svc:auth-svc'].what!;
  assert.equal(w.split(' · ').length, 4);
  assert.match(w, /\+1 more$/);
});
