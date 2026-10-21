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
const store = (id: string) => ({ id, kind: 'resource', label: id });
const SUB: Record<string, string> = { agent: 'a', 'pop-edge': 'n', 'pop-swg': 'n', auth: 'p', users: 'p', cfg: 'p' };
const subOf = (s: string) => SUB[s] ?? '';
const names = (cols: any[]) => cols.map((c) => c.service ?? c.id);

test('groupColumns: the caller stays first, a subsystem comes together in the order each first appears, the order inside a group is kept', () => {
  const cols = [svc('agent'), svc('auth'), svc('pop-edge'), svc('users'), svc('pop-swg'), svc('cfg')];
  assert.deepEqual(names(groupColumns(cols, subOf)), ['agent', 'auth', 'users', 'cfg', 'pop-edge', 'pop-swg']);
  assert.deepEqual(names(cols), ['agent', 'auth', 'pop-edge', 'users', 'pop-swg', 'cfg'], 'the input is not changed');
});

test('groupColumns: a component with no subsystem, a topic, a queue and a store keep their place', () => {
  const cols = [svc('agent'), svc('auth'), ch('sns:t'), svc('loose'), svc('pop-edge'), store('res:x'), svc('users'), svc('pop-swg')];
  assert.deepEqual(names(groupColumns(cols, subOf)), ['agent', 'auth', 'sns:t', 'loose', 'users', 'res:x', 'pop-edge', 'pop-swg']);
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
  assert.deepEqual(names(lane.columns), ['agent', 'auth', 'users', 'pop-edge']);
  assert.equal(ev.from, cols[1], 'an event still points at its column object');
  assert.deepEqual(lane.group.info('n'), subs.info('n'));
  const off: any = { columns: [svc('agent'), svc('auth'), svc('pop-edge'), svc('users')] };
  groupLane(off, subs, false, null);
  assert.deepEqual(names(off.columns), ['agent', 'auth', 'pop-edge', 'users'], 'off: the order is the flow\'s own');
  assert.equal(off.group, undefined);
});

test('step keys do not depend on the column order: a step is its event, not its place', () => {
  const cols = [svc('agent'), svc('auth'), svc('pop-edge')];
  const events = [{ type: 'call', key: 's1', from: cols[0], to: cols[1] }, { type: 'call', key: 's2', from: cols[1], to: cols[2] }];
  const before = events.map((e) => e.key);
  groupColumns(cols, subOf);
  assert.deepEqual(events.map((e) => e.key), before);
});
