// 0.28.1: subsystem bands over a flow's heads (web/js/views/flow-bands.js, pure) and what Group by subsystem does to a lane.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { groupColumns, subBands } from '../web/js/views/flow-bands.js';
// @ts-ignore
import { groupLane } from '../web/js/views/flow-group.js';
// @ts-ignore
import { createSubsystems } from '../web/js/design/subsystems-store.js';

const svc = (service: string) => ({ id: `svc:${service}`, kind: 'service', service, label: service });
const ch = (id: string) => ({ id, kind: 'channel', label: id });
const store = (id: string, owner: string | null = null) => ({ id, kind: 'resource', label: id, owner });
const SUB: Record<string, string> = { agent: 'a', 'pop-edge': 'n', 'pop-swg': 'n', auth: 'p', users: 'p', cfg: 'p' };
const subOf = (s: string) => SUB[s] ?? '';
const names = (cols: any[]) => cols.map((c) => c.service ?? c.id);

test('groupColumns: the caller stays first, a subsystem comes together in the order each first appears, the order inside a group is kept', () => {
  const cols = [svc('agent'), svc('auth'), svc('pop-edge'), svc('users'), svc('pop-swg'), svc('cfg')];
  assert.deepEqual(names(groupColumns(cols, subOf)), ['agent', 'auth', 'users', 'cfg', 'pop-edge', 'pop-swg']);
  assert.deepEqual(names(cols), ['agent', 'auth', 'pop-edge', 'users', 'pop-swg', 'cfg'], 'the input is not changed');
});

test('groupColumns: a component with no subsystem, a topic and a queue keep their place', () => {
  const cols = [svc('agent'), svc('auth'), ch('sns:t'), svc('loose'), svc('pop-edge'), svc('users'), svc('pop-swg')];
  assert.deepEqual(names(groupColumns(cols, subOf)), ['agent', 'auth', 'sns:t', 'loose', 'users', 'pop-edge', 'pop-swg']);
});

test('groupColumns: already together, or nothing to group, changes nothing', () => {
  const cols = [svc('agent'), svc('pop-edge'), svc('pop-swg'), svc('auth')];
  assert.deepEqual(names(groupColumns(cols, subOf)), names(cols));
  assert.deepEqual(names(groupColumns(cols, () => '')), names(cols));
});

test('subBands: a run of heads of one subsystem is one band; a topic, a queue or a store between two components ends it', () => {
  const cols = [svc('agent'), svc('pop-edge'), svc('pop-swg'), ch('t'), svc('auth'), svc('users')];
  assert.deepEqual(subBands(cols, new Set(), subOf), [{ key: 'a', from: 0, to: 0 }, { key: 'n', from: 1, to: 2 }, { key: 'p', from: 4, to: 5 }]);
  assert.deepEqual(subBands([svc('auth'), ch('t'), svc('users')], new Set(), subOf).length, 2, 'the topic is no member');
});

test('subBands: a Squeeze fold of one subsystem joins its band, a mixed fold has none and ends the run', () => {
  const cols = [svc('agent'), svc('auth'), svc('users'), svc('cfg'), svc('pop-edge')];
  assert.deepEqual(subBands(cols, new Set([2, 3]), subOf), [{ key: 'a', from: 0, to: 0 }, { key: 'p', from: 1, to: 3 }, { key: 'n', from: 4, to: 4 }]);
  assert.deepEqual(subBands(cols, new Set([3, 4]), subOf), [{ key: 'a', from: 0, to: 0 }, { key: 'p', from: 1, to: 2 }], 'cfg and pop-edge folded together: mixed');
});

test('groupLane: Group by subsystem sets the order and the group once, de-clashes colours, and leaves the events on their column objects', () => {
  const subs = createSubsystems({ subsystems: [{ key: 'a', label: 'A', components: [{ name: 'agent' }] }, { key: 'n', label: 'N', components: [{ name: 'pop-edge' }] }, { key: 'p', label: 'P', components: [{ name: 'auth' }, { name: 'users' }] }] });
  const cols = [svc('agent'), svc('auth'), svc('pop-edge'), svc('users')], ev = { type: 'call', from: cols[1], to: cols[2] };
  const lane: any = { columns: cols, events: [ev] };
  const slotsOf = (cs: any[]) => new Map(cs.map((c, i) => [c.service, i + 1]));
  groupLane(lane, subs, true, null, slotsOf);
  assert.deepEqual(lane.columns.map((c: any) => c.slot), [1, 2, 3, 4], 'each column carries its flow slot');
  assert.deepEqual(names(lane.columns), ['agent', 'pop-edge', 'auth', 'users'], '#138: the environment\'s subsystem order (a, n, p), not first appearance');
  assert.equal(ev.from, cols[1], 'an event still points at its column object');
  assert.deepEqual(lane.group.info('n'), subs.info('n'));
  const off: any = { columns: [svc('agent'), svc('auth'), svc('pop-edge'), svc('users')] };
  groupLane(off, subs, false, null, null, null, false); // By call order (#138): no regrouping
  assert.deepEqual(names(off.columns), ['agent', 'auth', 'pop-edge', 'users'], 'By call order: the order is the flow\'s own');
  assert.equal(off.group, undefined);
  const bandsOff: any = { columns: [svc('agent'), svc('auth'), svc('pop-edge'), svc('users')] };
  groupLane(bandsOff, subs, false, null);
  assert.deepEqual(names(bandsOff.columns), ['agent', 'pop-edge', 'auth', 'users'], 'bands off: still by subsystem (the Order option decides)');
  assert.equal(bandsOff.group, undefined);
});

test('step keys do not depend on the column order: a step is its event, not its place', () => {
  const cols = [svc('agent'), svc('auth'), svc('pop-edge')];
  const events = [{ type: 'call', key: 's1', from: cols[0], to: cols[1] }, { type: 'call', key: 's2', from: cols[1], to: cols[2] }];
  const before = events.map((e) => e.key);
  groupColumns(cols, subOf);
  assert.deepEqual(events.map((e) => e.key), before);
});

// #67 (0.30.1): a data store is drawn in the band of the subsystem of the component that owns it.
test('groupColumns: a store goes right after its owner subsystem, whatever component of another subsystem uses it', () => {
  const cols = [svc('agent'), svc('auth'), svc('pop-edge'), store('res:tpm', 'agent'), store('res:users-db', 'users'), svc('users')];
  assert.deepEqual(names(groupColumns(cols, subOf)), ['agent', 'res:tpm', 'auth', 'users', 'res:users-db', 'pop-edge']);
});

test('groupColumns: a store with no owner, or an owner in no subsystem, goes to the end of the components (the Shared band); collections of one store stay together', () => {
  const cols = [svc('agent'), store('res:a/x'), store('res:b', 'loose'), svc('pop-edge'), store('res:a/y'), store('res:c', 'auth'), svc('auth'), svc('loose'), ch('t')];
  assert.deepEqual(names(groupColumns(cols, subOf)), ['agent', 'pop-edge', 'auth', 'res:c', 'loose', 'res:a/x', 'res:b', 'res:a/y', 't']); // Shared keeps the stores' order
});

test('groupColumns: a store whose owner subsystem has no component in the flow still gets that subsystem band, before Shared', () => {
  const cols = [svc('agent'), store('res:s'), store('res:p', 'cfg')];
  assert.deepEqual(names(groupColumns(cols, subOf)), ['agent', 'res:p', 'res:s']);
  assert.deepEqual(subBands(groupColumns(cols, subOf), new Set(), subOf).map((b: any) => b.key), ['a', 'p', '~shared']);
});

test('subBands: a store is a member of its owner band; Shared is its own band, a topic between ends the run', () => {
  const cols = [svc('agent'), store('res:tpm', 'agent'), svc('auth'), store('res:db', 'users'), store('res:cache'), ch('t')];
  assert.deepEqual(subBands(cols, new Set(), subOf), [{ key: 'a', from: 0, to: 1 }, { key: 'p', from: 2, to: 3 }, { key: '~shared', from: 4, to: 4 }]);
});

test('groupLane: collection lifelines of a folded store follow the owner too', () => {
  const subs = createSubsystems({ subsystems: [{ key: 'a', label: 'A', components: [{ name: 'agent' }] }, { key: 'p', label: 'P', components: [{ name: 'auth' }] }] });
  const lane: any = { columns: [svc('agent'), svc('auth'), { ...store('res:db/x', 'agent'), group: 'db' }, { ...store('res:db/y', 'agent'), group: 'db' }], events: [] };
  assert.deepEqual(names(groupLane(lane, subs, true, null).columns), ['agent', 'res:db/x', 'res:db/y', 'auth']);
});

test('groupColumns with the environment order (#138): two parents with two children each, interleaved calls, come out contiguous and in env order', () => {
  const P: Record<string, [string, string]> = { b1: ['agent', 'agent/net'], a1: ['platform', 'platform/identity'], b2: ['agent', 'agent/core'], a2: ['platform', 'platform/objects'], a0: ['platform', ''] };
  const top = (n: string) => P[n]?.[0] ?? '', two = (n: string) => P[n]?.[1] ?? '';
  const ranked = ['platform', 'platform\n', 'platform\nplatform/identity', 'platform\nplatform/objects', 'agent', 'agent\n', 'agent\nagent/core', 'agent\nagent/net'];
  const cols = [{ id: 'client', kind: 'client', label: 'client' }, svc('b1'), svc('a2'), svc('b2'), svc('a1'), svc('a0')];
  assert.deepEqual(names(groupColumns(cols, top, two, ranked)), ['client', 'a0', 'a1', 'a2', 'b2', 'b1']);
});

test('#139 groupColumns: a store / channel whose owner is not in the flow stays next to its first accessor / sender; an owner in the flow still wins', () => {
  const q = { ...ch('sqs:q'), owner: 'cfg' };
  const cols = [svc('agent'), svc('auth'), store('res:zz', 'gone'), svc('pop-edge'), store('res:users', 'users'), svc('users'), q, svc('pop-swg')];
  const out = names(groupColumns(cols, subOf));
  assert.equal(out[out.indexOf('res:zz') - 1], 'auth', 'after auth, its first accessor');
  assert.equal(out.indexOf('res:users'), out.indexOf('users') + 2, 'right after its owner (the channel of the absent owner is between: it follows the nearest component)');
  assert.equal(out[out.indexOf('sqs:q') - 1], 'users', 'after the nearest component before it in the trace order');
});
