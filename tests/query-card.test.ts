// Frame 35: query cards. The pure parts (summary line, call line, groups, value validation, schema marks) and the manifest schema's `fields[].value`.
// Demo: samples/group-paths.json `in.unregisterDevice` (a merged run of 3 Mongo calls on Device).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summaryText, callLineText, groups, valueOf, hasValues, paramName, isHelper, usedLetters } from '../core/query-card.ts';
import type { StepField } from '../core/types.ts';
import { startApp, readSample, sampleManifests } from './helpers.ts';

const HF = 'helper_implicit_filter; db-lib:lib/schemas/Device.js:106';
const f = (role: StepField['role'], path: string, more: Partial<StepField> = {}): StepField => ({ role, path, ...more });
const call1: StepField[] = [f('filter', 'userId', { value: { from: 'params.userId', kind: 'param' } }), f('filter', 'deviceIdentifier'), f('filter', 'tenantId', { flag: HF }), f('filter', 'removed', { flag: HF }), f('projection', 'status'), f('projection', 'lastSeen'), f('projection', 'x')];
const call3: StepField[] = [f('filter', 'deviceIdentifier'), f('filter', 'tenantId', { flag: HF }), f('update', 'status', { operator: '$set' }), f('sort', 'lastSeen', { operator: 'desc' })];

test('summary: per role F P U S, two names then +N, helper filters counted apart', () => {
  assert.equal(summaryText(call1), 'F userId deviceIdentifier +2 implicit P status lastSeen +1');
  assert.equal(summaryText(call3), 'F deviceIdentifier +1 implicit U status S lastSeen');
  assert.equal(summaryText([f('filter', 'a'), f('filter', 'b'), f('filter', 'c'), f('filter', 'd')]), 'F a b +2');
  assert.equal(summaryText([f('filter', 'a', { flag: HF }), f('filter', 'b', { flag: HF })]), 'F 2 implicit', 'only helper filters');
  assert.equal(summaryText([]), ''); assert.equal(summaryText(undefined), '');
  assert.ok(isHelper(f('filter', 'a', { flag: HF })) && !isHelper(f('filter', 'a', { flag: 'remark' })) && !isHelper(f('filter', 'a')));
});

test('call line: Collection.op({ filters }, { projection }); values only when asked and present', () => {
  assert.equal(callLineText('Device', 'findOneActive', call1), 'Device.findOneActive({\n  userId,\n  deviceIdentifier,\n  tenantId,\n  removed\n},\n{ status, lastSeen, x })');
  assert.equal(callLineText('Device', 'findOneActive', call1, true).split('\n')[1], '  userId: params.userId,', 'a value fills in, a field without one stays a bare name');
  assert.equal(callLineText('D', 'updateOne', call3), 'D.updateOne({\n  deviceIdentifier,\n  tenantId\n},\n{ $set: { status } },\n{ sort: { lastSeen: -1 } })');
  assert.equal(callLineText('D', 'find', [f('filter', 'at', { operator: '$gt' })]), 'D.find({\n  at: { $gt: … }\n})');
  assert.equal(callLineText('D', 'count', []), 'D.count({})');
});

test('groups: only those present, in the order Filter Projection Update Sort, operator "=" only for a filter', () => {
  const g = groups([f('sort', 'a', { operator: 'asc' }), f('filter', 'b'), f('update', 'c', { operator: '$set', inDdl: false }), f('filter', 'h', { flag: HF })]);
  assert.deepEqual(g.map((x) => x.title), ['Filter', 'Update', 'Sort']);
  assert.deepEqual(g[0].rows.map((r) => [r.f.path, r.op, r.helper]), [['b', '=', false], ['h', '=', true]]);
  assert.deepEqual([g[1].rows[0].op, g[1].rows[0].noDdl, g[2].rows[0].op], ['$set', true, 'asc']);
  assert.deepEqual(groups([f('projection', 'p')])[0].rows[0].op, '');
});

test('value: unknown kind reads as expr, a long from is cut with an ellipsis, junk is none', () => {
  assert.deepEqual(valueOf({ value: { from: 'params.x', kind: 'param', source: { file: 'a.js', line: 3 } } }), { from: 'params.x', kind: 'param', source: { file: 'a.js', line: 3 } });
  assert.equal(valueOf({ value: { from: 'x', kind: 'cookie' } })!.kind, 'expr');
  assert.equal(valueOf({ value: { from: 'x' } })!.kind, 'expr');
  const long = valueOf({ value: { from: 'a'.repeat(300) } })!.from; assert.equal(long.length, 120); assert.ok(long.endsWith('…'));
  for (const bad of [undefined, null, { from: '' }, { from: '  ' }, { from: 5 }, 'x']) assert.equal(valueOf({ value: bad as any }), null);
  assert.equal(hasValues(call1), true); assert.equal(hasValues(call3), false); assert.equal(hasValues(undefined), false);
  assert.equal(paramName(valueOf({ value: { from: 'params.deviceIdentifier', kind: 'param' } })), 'deviceIdentifier');
  assert.equal(paramName(valueOf({ value: { from: 'params.a', kind: 'ctx' } })), null);
});

test('schema marks: the union of the open calls, letters in the order F P U S', () => {
  const m = usedLetters([call1, call3]);
  assert.deepEqual(m.get('status'), ['P', 'U']); assert.deepEqual(m.get('lastSeen'), ['P', 'S']); assert.deepEqual(m.get('tenantId'), ['F']);
  assert.equal(usedLetters([]).size, 0, 'no call open: no marks');
});

test('manifest: fields[].value is optional; unknown kind accepted; from over 120 characters is a 422; extra keys are refused', async () => {
  const app = await startApp();
  try {
    const m = readSample('group-paths.json'); m.version += 1;
    const fields = (m.functions as any[]).find((x) => x.id === 'DeviceService.remove').steps[0].fields as any[];
    const post = async () => (await app.call('POST', '/api/ingest?dryRun=1', m)).status;
    assert.equal(await post(), 200, 'the sample with values');
    fields[0].value = { from: 'params.userId', kind: 'weird-kind' }; assert.equal(await post(), 200);
    fields[0].value = { from: 'x'.repeat(121) }; assert.equal(await post(), 422);
    fields[0].value = { from: 'x'.repeat(120) }; assert.equal(await post(), 200);
    fields[0].value = { from: 'x', extra: 1 }; assert.equal(await post(), 422);
    fields[0].value = { kind: 'param' }; assert.equal(await post(), 422, 'from is required');
    fields[0].value = { from: 'x', source: { file: 'a.js', line: 0 } }; assert.equal(await post(), 422);
    delete fields[0].value; assert.equal(await post(), 200, 'no value at all is fine');
  } finally { await app.close(); }
});

test('the merged run carries the fields (and values) of each call on the trace', async () => {
  const app = await startApp();
  try {
    assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
    const t = (await app.call('GET', '/api/envs/prod/trace?service=group-paths&ingress=in.unregisterDevice&detail=external')).body;
    const g = t.messages.find((x: any) => x.dbGroup);
    assert.equal(g.dbGroup.calls.length, 3); assert.equal(g.dbGroup.collections[0], 'Device');
    const [a, b, c] = g.dbGroup.calls.map((x: any) => x.fields as StepField[]);
    assert.equal(a.filter(isHelper).length, 2); assert.equal(summaryText(a), 'F userId deviceIdentifier +2 implicit P status lastSeen +1');
    assert.ok(hasValues(a) && hasValues(b) && hasValues(c));
    assert.equal(c.find((x) => x.path === 'agentBuild')!.inDdl, false);
    assert.equal(g.dbGroup.calls[2].onlyWhen.guard, 'device found');
  } finally { await app.close(); }
});
