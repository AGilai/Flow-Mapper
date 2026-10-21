// Marks at the subsystem level (core/diff/subsystems.ts): grp: and link: anchors, derived from members and links; reordering never marks.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffEnv } from '../core/diff/index.ts';
import { sourceNow, type BaseRow } from '../core/diff/source-now.ts';
import type { ItemRow } from '../core/item-rows.ts';
import { rows } from './subsystem-fixture.ts';

const diff = (b: ItemRow[], c: ItemRow[]) => diffEnv(b, c, { against: 'baseline' });
const grp = (m: ReturnType<typeof diff>, k: string) => m.marks[`grp:${k}`];
const link = (): ItemRow => ({ service: '', list: 'link', key: 'usage', data: { name: 'usage', from: 'grp:network', to: 'grp:platform' } });

test('identical sides: no grp marks', () => assert.deepEqual(diff(rows(), rows()).marks, {}));

test('a new subsystem row is new; so is a subsystem whose every component is new ("whole subsystem new")', () => {
  const cur = rows();
  cur.push({ service: '', list: 'subsystem', key: 'edge', data: { label: 'Edge', order: 3 } });
  assert.equal(grp(diff(rows(), cur), 'edge').mark, 'new');
  const base = rows().filter((r) => r.service !== 'sase-agent');            // Agent had no component in the baseline
  const m = diff(base, rows());
  assert.deepEqual(grp(m, 'agent'), { mark: 'new', what: 'whole subsystem new' });
  assert.equal(m.marks['svc:sase-agent'].mark, 'new', 'the component keeps its own mark');
  assert.equal(grp(m, 'platform'), undefined);
});

test('a changed or new member makes the subsystem changed, with the parts in what', () => {
  const base = rows(), cur = rows();
  cur.find((r) => r.service === 'auth-svc' && r.list === 'ingress')!.data.handler = 'Other.handler';
  cur.push({ service: 'users-svc', list: 'ingress', key: 'in.new', data: { id: 'in.new', transport: 'http', bindKey: 'http:GET users-svc/new', handler: 'Users.list' } });
  const m = diff(base, cur);
  assert.deepEqual(grp(m, 'platform'), { mark: 'changed', what: '2 changed components' });
  assert.equal(grp(m, 'network'), undefined);
  assert.equal(m.counts.subsystems.changed, 1);
  const added = rows(); added.push({ service: 'newbie', list: 'header', key: '', data: { kind: 'service', groupPath: 'platform' } });
  assert.equal(grp(diff(rows(), added), 'platform').what, '1 new component');
  const removed = rows().filter((r) => r.service !== 'billing-svc');
  assert.equal(grp(diff(rows(), removed), 'platform').what, '1 removed component');
});

test('a component that moves subsystem: moved in / moved out on both boxes, and no svc: mark (groupPath is not a component change)', () => {
  const cur = rows();
  cur.find((r) => r.service === 'users-svc' && r.list === 'header')!.data.groupPath = 'network';
  const m = diff(rows(), cur);
  assert.equal(grp(m, 'network').what, 'moved in: users-svc');
  assert.equal(grp(m, 'platform').what, 'moved out: users-svc');
  assert.equal(m.marks['svc:users-svc'], undefined);
  // a copied component with no groupPath in the baseline is no move
  const base = rows(); delete base.find((r) => r.service === 'users-svc' && r.list === 'header')!.data.groupPath;
  assert.equal(grp(diff(base, rows()), 'platform'), undefined);
});

test('label or icon change marks changed; reordering never does; delete is a removed ghost with the old label', () => {
  const cur = rows();
  cur.find((r) => r.list === 'subsystem' && r.key === 'platform')!.data.label = 'Core';
  assert.equal(grp(diff(rows(), cur), 'platform').what, 'label');
  const icon = rows(); icon.find((r) => r.list === 'subsystem' && r.key === 'agent')!.data.icon = 'cloud';
  assert.equal(grp(diff(rows(), icon), 'agent').what, 'icon');
  const reordered = rows(); reordered.forEach((r) => { if (r.list === 'subsystem') r.data.order = 2 - r.data.order; });
  assert.deepEqual(diff(rows(), reordered).marks, {});
  const dropped = rows().filter((r) => !(r.list === 'subsystem' && r.key === 'agent') && r.service !== 'sase-agent');
  const m = diff(rows(), dropped);
  assert.equal(grp(m, 'agent').mark, 'removed'); assert.equal(m.ghosts['grp:agent'].label, 'Agent', 'the old label'); assert.equal(m.counts.subsystems.removed, 1);
});

test('link: new, changed (refined) and removed; a link into a subsystem marks that subsystem', () => {
  const cur = rows(); cur.push(link());
  const m = diff(rows(), cur);
  assert.equal(m.marks['link:usage'].mark, 'new'); assert.equal(m.counts.links.new, 1);
  assert.equal(grp(m, 'network').what, '+1 link'); assert.equal(grp(m, 'platform').what, '+1 link'); assert.equal(grp(m, 'agent'), undefined);
  const base = rows(); base.push(link());
  const refined = rows(); refined.push({ ...link(), data: { ...link().data, from: 'egr:pop-edge/out.auth', to: 'ing:auth-svc/in.token', refinedBy: [{ service: 'pop-edge', egress: 'out.auth' }] } });
  const r = diff(base, refined);
  assert.equal(r.marks['link:usage'].mark, 'changed'); assert.equal(r.counts.links.changed, 1);
  assert.equal(diff(base, rows()).marks['link:usage'].mark, 'removed');
  // null / empty values are the same as absent
  const nulls = rows(); nulls.push({ ...link(), data: { ...link().data, transport: null, refinedBy: [] } });
  assert.deepEqual(diff(base, nulls).marks, {});
});

test('against the source: design rows pass through, so a design-made link is new against both; subsystem rows are not compared with the source\'s', () => {
  const baseRows: BaseRow[] = rows().filter((r) => r.list === 'subsystem' || r.service === 'auth-svc').map((r) => ({ ...r, sourceEnv: 'prod', sourceVersion: null, takenAt: 't' }));
  const srcRows: ItemRow[] = [{ service: '', list: 'subsystem', key: 'platform', data: { label: 'Other label', order: 0 } }, ...rows().filter((r) => r.service === 'auth-svc')];
  const now = sourceNow(new Map([['prod', srcRows]]), baseRows).rows;
  assert.deepEqual(now.filter((r) => r.list === 'subsystem').map((r) => `${r.key}:${r.data.label}`).sort(), ['agent:Agent', 'network:Network (POP)', 'platform:Platform']);
  const cur = rows().filter((r) => r.list === 'subsystem' || r.service === 'auth-svc'); cur.push(link());
  const m = diffEnv(now, cur, { against: 'source' });
  assert.equal(m.marks['link:usage'].mark, 'new');
  assert.equal(grp(m, 'platform').what, '+1 link');
});
