// 0.50.0 (#103): the second groupPath level as a band row under the subsystem row (flow-bands.js, flow-group.js, flow-draw-bands.js, core/subsystems.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
// @ts-ignore plain JS modules shared with the browser
import { groupColumns, subBands, subSubBands } from '../web/js/views/flow-bands.js';
// @ts-ignore
import { groupLane } from '../web/js/views/flow-group.js';
// @ts-ignore
import { createSubsystems } from '../web/js/design/subsystems-store.js';
import { subsystemsOf } from '../core/subsystems.ts';

const svc = (service: string) => ({ id: `svc:${service}`, kind: 'service', service, label: service });
const store = (id: string, owner: string | null = null) => ({ id, kind: 'resource', label: id, owner });
const names = (cols: any[]) => cols.map((c) => c.service ?? c.id);
const SUB: Record<string, string> = { gcp: 'platform', sdp: 'platform', sdp2: 'platform', cons: 'platform', web: 'edge' };
const SUB2: Record<string, string> = { gcp: 'platform/gcp', sdp: 'platform/sdp', sdp2: 'platform/sdp', cons: 'platform/sdp' };
const subOf = (s: string) => SUB[s] ?? '', sub2Of = (s: string) => SUB2[s] ?? '';
const read = (p: string) => readFileSync(new URL(`../web/js/views/${p}`, import.meta.url), 'utf8');

test('groupColumns: each sub-subsystem stays together inside its subsystem', () => {
  const cols = [svc('web'), svc('sdp'), svc('gcp'), svc('sdp2'), svc('cons')];
  assert.deepEqual(names(groupColumns(cols, subOf, sub2Of)), ['web', 'sdp', 'sdp2', 'cons', 'gcp']);
  assert.deepEqual(names(groupColumns(cols, subOf)), ['web', 'sdp', 'gcp', 'sdp2', 'cons'], 'without the second level: the first-level order only');
});

test('subSubBands: runs of one second level, none for a component without it; a store or a fold decides the run', () => {
  const cols = [svc('web'), svc('gcp'), svc('sdp'), svc('sdp2'), store('res:r', 'sdp'), svc('cons')];
  assert.deepEqual(subSubBands(cols, new Set(), sub2Of), [{ key: 'platform/gcp', from: 1, to: 1 }, { key: 'platform/sdp', from: 2, to: 3 }, { key: 'platform/sdp', from: 5, to: 5 }]);
  assert.deepEqual(subBands(cols, new Set(), subOf).map((b: any) => b.key), ['edge', 'platform'], 'the subsystem row is unchanged');
  assert.deepEqual(subSubBands([svc('web'), svc('gcp')], new Set(), () => ''), [], 'nothing deep: no sub-subsystem band');
  assert.deepEqual(subSubBands([svc('gcp'), svc('sdp'), svc('sdp2')], new Set([1, 2]), sub2Of), [{ key: 'platform/gcp', from: 0, to: 0 }, { key: 'platform/sdp', from: 1, to: 2 }], 'a fold of one sub-subsystem joins its run');
  assert.deepEqual(subSubBands([svc('gcp'), svc('sdp')], new Set([0, 1]), sub2Of), [], 'a mixed fold has no band');
});

test('the store: subOf2 is the full key, subLabel the registered name else the segment; a third segment folds into the second', () => {
  const rows: any[] = [{ service: '', list: 'subsystem', key: 'platform', data: { label: 'Platform', order: 0 } }, { service: '', list: 'subsystem', key: 'platform/gcp', data: { label: 'Google Cloud', order: 1 } }];
  const list = subsystemsOf(rows, [{ name: 'g', kind: 'service', groupPath: 'platform/gcp' }, { name: 's', kind: 'service', groupPath: 'platform/sdp/deep' }, { name: 'p', kind: 'service', groupPath: 'platform' }] as any);
  assert.equal(list.length, 1, 'a second-level row is no subsystem');
  assert.deepEqual(list[0].subs, [{ key: 'platform/gcp', label: 'Google Cloud' }]);
  assert.deepEqual(list[0].components.map((c: any) => [c.name, c.sub ?? null]), [['g', 'gcp'], ['p', null], ['s', 'sdp']]);
  const subs = createSubsystems({ subsystems: list } as any);
  assert.deepEqual(['g', 's', 'p'].map(subs.subOf2), ['platform/gcp', 'platform/sdp', '']);
  assert.deepEqual([subs.subLabel('platform/gcp'), subs.subLabel('platform/sdp')], ['Google Cloud', 'sdp']);
});

test('groupLane carries the second level into lane.group; off: no group at all', () => {
  const subs = createSubsystems({ subsystems: [{ key: 'platform', label: 'Platform', components: [{ name: 'gcp', sub: 'gcp' }, { name: 'sdp', sub: 'sdp' }], subs: [{ key: 'platform/sdp', label: 'SDP' }] }] } as any);
  const lane: any = { columns: [svc('sdp'), svc('gcp')], events: [] };
  groupLane(lane, subs, true, null);
  assert.equal(lane.group.subOf2('gcp'), 'platform/gcp');
  assert.equal(lane.group.subLabel('platform/sdp'), 'SDP');
  const off: any = { columns: [svc('sdp')], events: [] };
  groupLane(off, subs, false, null);
  assert.equal(off.group, undefined, 'the subsystem band is off: so is the sub-band');
});

test('source: a row for the sub-subsystems between the subsystem and the store rows; the sub band has no details click', () => {
  const lay = read('flow-draw-layout.js');
  assert.match(lay, /sub2Runs\.length \? 1 : 0/);
  assert.match(lay, /sub2: true, row: 1/);
  assert.match(lay, /row: \(subRuns\.length \? 1 : 0\) \+ \(sub2Runs\.length \? 1 : 0\)/, 'the store row is under both');
  assert.match(read('flow-draw-bands.js'), /band sub sub2/);
  assert.match(read('flow-draw-events.js'), /band\.sub:not\(\.sub2\)/);
});
