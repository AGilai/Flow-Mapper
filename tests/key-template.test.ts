// #86 (0.42.1): details.keyPattern is an alias of details.keyTemplate; `{unresolved:<reasons>}` is not a key; the trace carries the key fields.
// Demo: users-svc get_posture step 2 sends details.keyPattern.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, sampleModel, startApp } from './helpers.ts';
import { keyTemplateOf } from '../core/key-template.ts';
import { buildIndex } from '../core/graph-index.ts';
import { keyFlows } from '../core/instances.ts';
import { DETAIL_PATHS } from '../core/contract.ts';

const st = (details: any) => ({ details }) as any;

test('keyTemplateOf: keyTemplate, keyPattern, both (keyTemplate wins), neither', () => {
  assert.deepEqual(keyTemplateOf(st({ keyTemplate: 'a:{id}' })), { key: 'a:{id}', unresolved: [] });
  assert.deepEqual(keyTemplateOf(st({ keyPattern: 'b:{id}' })), { key: 'b:{id}', unresolved: [] });
  assert.equal(keyTemplateOf(st({ keyTemplate: 'a:{id}', keyPattern: 'b:{id}' })).key, 'a:{id}');
  assert.equal(keyTemplateOf(st({ keyTemplate: '  ', keyPattern: 'b' })).key, 'b');
  assert.deepEqual(keyTemplateOf(st(undefined)), { key: null, unresolved: [] });
  assert.deepEqual(keyTemplateOf(st({ keyPattern: 5 })), { key: null, unresolved: [] });
});

test('keyTemplateOf: {unresolved:a,b} is no key, with its reasons', () => {
  assert.deepEqual(keyTemplateOf(st({ keyPattern: '{unresolved:computed, call_result:keyFn}' })), { key: null, unresolved: ['computed', 'call_result:keyFn'] });
  assert.deepEqual(keyTemplateOf(st({ keyTemplate: '{unresolved:x}' })), { key: null, unresolved: ['x'] });
  assert.deepEqual(keyTemplateOf(st({ keyPattern: '{unresolved:}' })), { key: null, unresolved: ['unresolved'] });
  assert.equal(keyTemplateOf(st({ keyPattern: 'session:{id}' })).key, 'session:{id}');
});

test('the contract accepts details.keyPattern as an unresolved detail path', () => assert.ok(DETAIL_PATHS.includes('details.keyPattern')));

test('a step with keyPattern joins its key row (flows of the key)', () => {
  const g = buildIndex(sampleModel());
  const f = keyFlows(g, 'redis:cache-main', [{ keyTemplate: 'user:{id}' }]).get('\u0000user:{id}')!;
  assert.ok(f.some((x) => x.step.service === 'users-svc' && x.operation === 'GET'), 'get_posture sends keyPattern');
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201); });
after(() => app.close());

test('trace messages of resource steps carry keyTemplate, dbIndex, ttlSeconds, keyUnresolved; absent is omitted', async () => {
  const m = sampleManifests().find((x: any) => x.service.name === 'users-svc');
  const fn = m.functions.find((f: any) => f.id === 'get_posture');
  fn.steps[1].details = { keyPattern: 'user:{id}', dbIndex: 2, ttlSeconds: 60 };
  fn.steps.splice(2, 0, { seq: 9, type: 'resource', target: 'cache', operation: 'GET k', details: { keyPattern: '{unresolved:computed,call_result:f}' } });
  fn.steps.splice(3, 0, { seq: 10, type: 'resource', target: 'cache', operation: 'GET j' });
  assert.equal((await app.call('POST', '/api/ingest', { manifests: [{ ...m, version: m.version + 1 }] })).status, 201);
  const q = '/api/envs/prod/trace?detail=full&choose=*:both&service=users-svc&ingress=in.getPosture&scope=intra';
  const msgs = (await app.call('GET', q)).body.messages.filter((x: any) => x.kind === 'resource');
  const by = (op: string) => msgs.find((x: any) => x.label === op);
  const a = by('GET posture:{id}'), u = by('GET k'), none = by('GET j');
  assert.deepEqual([a.keyTemplate, a.dbIndex, a.ttlSeconds, a.keyUnresolved], ['user:{id}', 2, 60, undefined]);
  assert.deepEqual([u.keyTemplate, u.keyUnresolved], [undefined, ['computed', 'call_result:f']]);
  assert.ok(!('keyTemplate' in none) && !('keyUnresolved' in none) && !('dbIndex' in none) && !('details' in a));
});
