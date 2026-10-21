// Subsystem and link edits as ops (core/edit-subsystems.ts) and the rules the whole request must pass (prepareOps): BAD_KEY, BAD_ICON, NO_GROUP,
// GROUP_IN_USE, TWO_GROUPS, link ids. One component, one subsystem: a new groupPath moves it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designEditOps, EditError, type DesignEdit } from '../core/design-edit.ts';
import { rowId, type ItemRow } from '../core/item-rows.ts';
import { prepareOps } from '../server/store/draft-validate.ts';
import { rows } from './subsystem-fixture.ts';

const fail = (f: () => unknown) => { try { f(); } catch (e: any) { return `${e.code}${e.field ? `:${e.field}` : ''}`; } return 'no error'; };
/** Build the edit's ops over `rs` and validate them like appendOps does; returns the rows afterwards. */
function run(rs: ItemRow[], ...edits: DesignEdit[]) {
  const map = new Map(rs.map((r) => [rowId(r), r])), ops = edits.flatMap((e) => designEditOps(e, [...map.values()]));
  prepareOps(map, ops, { groups: [] });
  return { rows: [...map.values()], ops };
}
const code = (rs: ItemRow[], ...edits: DesignEdit[]) => { try { run(rs, ...edits); } catch (e: any) { return e.code as string; } return 'no error'; };
const sub = (rs: ItemRow[]) => rs.filter((r) => r.list === 'subsystem').sort((a, b) => a.data.order - b.data.order).map((r) => `${r.key}:${r.data.order}`).join(' ');

test('subsystem: a new one needs a label and goes last; label and icon change in place; icon null clears it', () => {
  assert.equal(fail(() => designEditOps({ kind: 'subsystem', key: 'edge' }, rows())), 'INVALID:label');
  const added = run(rows(), { kind: 'subsystem', key: 'edge', label: 'Edge', icon: 'cloud' });
  assert.deepEqual(added.ops, [{ op: 'upsert', anchor: 'grp:edge', data: { label: 'Edge', icon: 'cloud', order: 3 } }]);
  const relabel = designEditOps({ kind: 'subsystem', key: 'platform', label: 'Core platform' }, rows());
  assert.deepEqual(relabel, [{ op: 'upsert', anchor: 'grp:platform', data: { label: 'Core platform', icon: 'platform', order: 2 } }], 'the key is immutable: the label is the rename');
  assert.equal((designEditOps({ kind: 'subsystem', key: 'platform', icon: null }, rows())[0].data as any).icon, undefined);
  assert.deepEqual(designEditOps({ kind: 'subsystem', key: 'platform' }, rows()), [], 'nothing changes');
});

test('subsystem order: only the rows whose position changes are written', () => {
  const ops = designEditOps({ kind: 'subsystem', key: 'platform', order: 0 }, rows());
  assert.deepEqual(ops.map((o) => `${o.anchor}:${(o.data as any).order}`), ['grp:platform:0', 'grp:agent:1', 'grp:network:2']);
  assert.deepEqual(designEditOps({ kind: 'subsystem', key: 'network', order: 2 }, rows()).map((o) => o.anchor), ['grp:platform', 'grp:network'], 'network and platform swap');
  assert.equal(sub(run(rows(), { kind: 'subsystem', key: 'platform', order: 1 }).rows), 'agent:0 platform:1 network:2');
  assert.deepEqual(designEditOps({ kind: 'subsystem', key: 'agent', order: 0 }, rows()), [], 'already first');
});

test('BAD_KEY, BAD_ICON and a label of 1..80 characters', () => {
  assert.equal(fail(() => designEditOps({ kind: 'subsystem', key: 'Bad Key', label: 'x' }, rows())), 'BAD_KEY:key');
  assert.equal(fail(() => designEditOps({ kind: 'subsystem', key: 'ok', label: 'x', icon: 'rocket' as any }, rows())), 'BAD_ICON:icon');
  assert.equal(fail(() => designEditOps({ kind: 'subsystem', key: 'ok', label: 'x'.repeat(81) }, rows())), 'INVALID:label');
  assert.equal(code(rows(), { op: 'upsert', anchor: 'grp:Bad_Key', data: { label: 'x', order: 3 } } as any), 'INVALID', 'raw ops: the anchor');
  const raw = (data: any) => prepareOps(new Map(rows().map((r) => [rowId(r), r])), [{ op: 'upsert', anchor: 'grp:ok', data }], { groups: [] });
  assert.throws(() => raw({ label: 'x', icon: 'rocket', order: 3 }), (e: any) => e.code === 'BAD_ICON');
  assert.throws(() => raw({ label: '', order: 3 }), (e: any) => e.code === 'INVALID');
});

test('NO_GROUP: a groupPath must be a subsystem of the request\'s result, so one added earlier in the same request counts', () => {
  const comp = (groupPath: string): DesignEdit => ({ kind: 'component', name: 'newbie', serviceKind: 'service', groupPath });
  assert.equal(code(rows(), comp('ghost')), 'NO_GROUP');
  assert.equal(code(rows(), comp('platform/identity')), 'no error', 'a path under a subsystem');
  assert.equal(code(rows(), { kind: 'subsystem', key: 'ghost', label: 'Ghost' }, comp('ghost')), 'no error');
});

test('delete a subsystem: GROUP_IN_USE while a groupPath or a link end names it; it passes when the same request moves the components', () => {
  assert.equal(code(rows(), { kind: 'delete', anchor: 'grp:network' }), 'GROUP_IN_USE');
  const withLink = rows().filter((r) => r.service !== 'pop-edge');
  withLink.push({ service: '', list: 'link', key: 'l', data: { name: 'l', from: 'grp:network', to: 'grp:platform' } });
  assert.equal(code(withLink, { kind: 'delete', anchor: 'grp:network' }), 'GROUP_IN_USE', 'a link end');
  const empty = rows().filter((r) => r.service !== 'pop-edge');
  assert.equal(sub(run(empty, { kind: 'delete', anchor: 'grp:network' }).rows), 'agent:0 platform:2', 'nothing names it: it goes');
  const moved = run(rows(), { kind: 'component', name: 'pop-edge', serviceKind: 'service', groupPath: 'platform' }, { kind: 'delete', anchor: 'grp:network' });
  assert.equal(sub(moved.rows), 'agent:0 platform:2');
  assert.equal(code(rows(), { kind: 'delete', anchor: 'grp:nowhere' }), 'NO_ITEM');
});

test('a component edit with a new groupPath moves it: one subsystem, the old value is replaced', () => {
  const { rows: after } = run(rows(), { kind: 'component', name: 'pop-edge', serviceKind: 'service', groupPath: 'platform' });
  assert.equal(after.find((r) => r.service === 'pop-edge' && r.list === 'header')!.data.groupPath, 'platform');
});

test('TWO_GROUPS: one request must not give a component two subsystems; alsoIn does not exist', () => {
  const up = (groupPath: string) => ({ op: 'upsert', anchor: 'svc:pop-edge', data: { kind: 'service', groupPath } });
  const run2 = (ops: any[]) => prepareOps(new Map(rows().map((r) => [rowId(r), r])), ops, { groups: [] });
  assert.throws(() => run2([up('platform'), up('agent')]), (e: any) => e.code === 'TWO_GROUPS' && /pop-edge.*platform.*agent/.test(e.message));
  assert.doesNotThrow(() => run2([up('platform'), up('platform/identity')]), 'two paths under one subsystem are one subsystem');
  assert.throws(() => run2([{ op: 'upsert', anchor: 'svc:pop-edge', data: { kind: 'service', groupPath: 'network', alsoIn: ['platform'] } }]), (e: any) => e.code === 'TWO_GROUPS' && /pick one/.test(e.message));
  assert.throws(() => run2([{ op: 'upsert', anchor: 'svc:pop-edge', data: { kind: 'service', groupPath: 'network', details: { alsoIn: ['platform'] } } }]), (e: any) => e.code === 'TWO_GROUPS');
});

test('abstract-link: the id is the slug of the name, unique among links; explicit ids are checked; doc and refinedBy are kept; refinedBy null clears', () => {
  const l = (name: string, extra: any = {}): DesignEdit => ({ kind: 'abstract-link', name, from: 'grp:network', to: 'grp:platform', ...extra });
  const one = run(rows(), l('Usage metering (daily)'));
  assert.equal(one.ops[0].anchor, 'link:usage-metering-daily');
  const two = run(one.rows, l('Usage metering (daily)'));
  assert.equal(two.ops[0].anchor, 'link:usage-metering-daily-2', 'a taken id gets a suffix');
  assert.equal(fail(() => designEditOps(l('x', { id: 'Not Valid' }), rows())), 'BAD_NAME:id');
  assert.equal(fail(() => designEditOps(l('x', { to: 'grp:network' }), rows())), 'SAME_END:to');
  assert.equal(fail(() => designEditOps(l('x', { to: 'egr:pop-edge/out.auth' }), rows())), 'BAD_END:to');
  assert.equal(fail(() => designEditOps(l('x', { to: 'grp:ghost' }), rows())), 'NO_END:to');
  const rs = rows(); rs.push({ service: '', list: 'link', key: 'k', data: { name: 'k', from: 'grp:network', to: 'grp:platform', doc: { file: 'a.md' }, refinedBy: [{ service: 'pop-edge', egress: 'out.auth' }] } });
  const edited = designEditOps({ kind: 'abstract-link', id: 'k', name: 'k2', from: 'grp:network', to: 'grp:platform', mode: 'async', description: 'd' }, rs)[0].data as any;
  assert.deepEqual([edited.name, edited.mode, edited.doc, edited.refinedBy.length], ['k2', 'async', { file: 'a.md' }, 1]);
  assert.equal((designEditOps({ kind: 'abstract-link', id: 'k', name: 'k', from: 'grp:network', to: 'grp:platform', refinedBy: null }, rs)[0].data as any).refinedBy, undefined);
  assert.equal((designEditOps({ kind: 'abstract-link', id: 'k', name: 'k', from: 'grp:network', to: 'grp:platform', mode: null }, rs)[0].data as any).mode, undefined);
});

test('delete link: and a raw link op whose end is gone is rejected with its code', () => {
  const rs = rows(); rs.push({ service: '', list: 'link', key: 'k', data: { name: 'k', from: 'grp:network', to: 'grp:platform' } });
  assert.equal(designEditOps({ kind: 'delete', anchor: 'link:k' }, rs)[0].op, 'delete');
  assert.equal(code(rows(), { kind: 'delete', anchor: 'link:k' }), 'NO_ITEM');
  assert.throws(() => prepareOps(new Map(rows().map((r) => [rowId(r), r])), [{ op: 'upsert', anchor: 'link:z', data: { name: 'z', from: 'grp:network', to: 'svc:ghost' } }], { groups: [] }), (e: any) => e.code === 'NO_END');
  assert.ok(EditError);
});
