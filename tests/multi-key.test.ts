// #108: a Redis step on several keys sends `details.keys[]` (and `keyVariants`); the trace carries them, the singular fields fall back to keys[0],
// the instance page matches flows through any key, and the interim `multi_key` unresolved is dropped once keys[] names the keys. Demo: session-gateway DELETE /api/v1/session.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, sampleModel, startApp } from './helpers.ts';
import { keyFieldsOn, keyRefsOf, keyUsesOf } from '../core/key-template.ts';
import { unknownOn } from '../core/step-notes.ts';
import { buildIndex } from '../core/graph-index.ts';
import { groupDbOps } from '../core/trace-db-group.ts';
import { keyFlows } from '../core/instances.ts';
import { storePanel, reasonText } from '../core/store-panel.ts';

const st = (details: any, extra: any = {}) => ({ type: 'resource', details, ...extra }) as any;
const KEYS = [{ keyTemplate: 'a:{id}', keyVariants: ['a:${id}', 'a:{id}', ' '] }, { keyIdx: 5, keyTemplate: 'b:{id}', dbIndex: 2, ttlSeconds: 30 }, { keyTemplate: '{unresolved:computed}' }, null, {}];

test('keyRefsOf: keys in order, keyIdx defaults to the position, variants deduped, unresolved templates become reasons, empty entries dropped', () => {
  assert.deepEqual(keyRefsOf(st({ keys: KEYS })), [
    { keyIdx: 0, keyTemplate: 'a:{id}', keyVariants: ['a:${id}', 'a:{id}'] }, { keyIdx: 5, keyTemplate: 'b:{id}', dbIndex: 2, ttlSeconds: 30 }, { keyIdx: 2, keyUnresolved: ['computed'] }]);
  assert.deepEqual(keyRefsOf(st({ keys: 'x' })), []);
  assert.deepEqual(keyUsesOf(st({ keyTemplate: 'z', dbIndex: 1, ttlSeconds: 5, keys: KEYS })), [{ keyTemplate: 'z', dbIndex: 1, ttlSeconds: 5 }, { keyTemplate: 'a:{id}', dbIndex: 1, ttlSeconds: 5 }, { keyTemplate: 'b:{id}', dbIndex: 2, ttlSeconds: 30 }]);
});

test('keyFieldsOn: singular fields fall back to keys[0]; the step\'s own singular value wins; keyVariants on the singular form', () => {
  assert.deepEqual(keyFieldsOn(st({ keys: [{ keyTemplate: 'a:{id}', dbIndex: 1, ttlSeconds: 9, keyVariants: ['v'] }, { keyTemplate: 'b' }] })),
    { keyTemplate: 'a:{id}', keyVariants: ['v'], dbIndex: 1, ttlSeconds: 9, keys: [{ keyIdx: 0, keyTemplate: 'a:{id}', dbIndex: 1, ttlSeconds: 9, keyVariants: ['v'] }, { keyIdx: 1, keyTemplate: 'b' }] });
  assert.equal(keyFieldsOn(st({ keyTemplate: 'own', dbIndex: 3, keys: [{ keyTemplate: 'a', dbIndex: 1 }] })).keyTemplate, 'own');
  assert.equal(keyFieldsOn(st({ keyTemplate: 'own', dbIndex: 3, keys: [{ keyTemplate: 'a', dbIndex: 1 }] })).dbIndex, 3);
  assert.deepEqual(keyFieldsOn(st({ keyTemplate: 'k', keyVariants: ['k2', 'k3'] })), { keyTemplate: 'k', keyVariants: ['k2', 'k3'] });
  assert.deepEqual(keyFieldsOn(st({ keys: [{ keyUnresolved: ['computed'] }] })).keyUnresolved, ['computed']);
  assert.deepEqual(keyFieldsOn(st({})), {});
});

test('multi_key gap rule: keys[] that names a key answers the interim multi_key unresolved; without keys[] it stays; other reasons stay', () => {
  const mk = { what: 'detail', detail: 'details.keyTemplate', reason: 'multi_key', candidates: ['a', 'b'] }, other = { what: 'detail', detail: 'details.ttlSeconds', reason: 'computed' };
  assert.deepEqual(unknownOn(st({ keys: [{ keyTemplate: 'a' }] }, { unresolved: [mk, other] })), { unknown: [{ field: 'ttlSeconds', reason: 'computed' }] });
  assert.deepEqual(unknownOn(st({}, { unresolved: [mk] })), { unknown: [{ field: 'keyTemplate', reason: 'multi_key' }] });
  assert.deepEqual(unknownOn(st({ keys: [{ keyUnresolved: ['computed'] }] }, { unresolved: [mk] })), { unknown: [{ field: 'keyTemplate', reason: 'multi_key' }] });
  assert.equal(reasonText({ unknown: [{ field: 'keyTemplate', reason: 'multi_key' }] } as any), 'multi_key');
});

const model = () => {
  const m = sampleModel();
  return m;
};

test('instance flows: a step matches the key through any of its keys[] entries', () => {
  const g = buildIndex(model());
  const keys = ['session:{sessionId}', 'auth:access:{userId}', 'auth:refresh:{userId}', 'auth:tcp:{userId}'];
  const f = keyFlows(g, 'redis:p81-sessions', keys.map((keyTemplate) => ({ keyTemplate })));
  for (const k of keys) assert.ok(f.get(`\u0000${k}`)!.some((x) => x.ingress === 'in.revoke' && x.operation === 'DEL'), `${k} is deleted by in.revoke`);
  assert.ok(!f.get('\u0000auth:tcp:{userId}')!.some((x) => x.ingress === 'in.validate'));
  const db2 = keyFlows(g, 'redis:p81-sessions', [{ keyTemplate: 'x', dbIndex: 1 }]);
  assert.deepEqual(db2.get('1\u0000x'), []);
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201); });
after(() => app.close());

test('trace of the demo: the multi-key step carries keys[] and the singular fields from keys[0]; no multi_key unknown; the folded run keeps keys on its calls', async () => {
  const q = '/api/envs/prod/trace?detail=full&service=session-gateway&ingress=in.revoke&scope=intra';
  const msgs = (await app.call('GET', q)).body.messages.filter((x: any) => x.kind === 'resource');
  const get = msgs.find((x: any) => x.label === 'get'), del = msgs.find((x: any) => x.label === 'del');
  assert.deepEqual(get.keyVariants, ['session:${id}', 'sess:{sessionId}']);
  assert.deepEqual(del.keys.map((k: any) => [k.keyIdx, k.keyTemplate, k.dbIndex]), [[0, 'session:{sessionId}', undefined], [1, 'auth:access:{userId}', undefined], [2, 'auth:refresh:{userId}', undefined], [3, 'auth:tcp:{userId}', 2]]);
  assert.deepEqual([del.keyTemplate, del.dbIndex, del.keyVariants], ['session:{sessionId}', 1, ['session:${id}', 'sess:{sessionId}']]);
  assert.ok(!del.unknown, 'multi_key is answered by keys[]');
  const run = groupDbOps(msgs.map((m: any, i: number) => ({ m, i })))[0].m;
  assert.equal(run.label, '*2 get, del');
  assert.deepEqual(run.dbGroup.calls.map((c: any) => [c.keyVariants?.length ?? 0, c.keys?.length ?? 0]), [[2, 0], [2, 4]]);
});

test('store panel: a multi-key step is a row in each key\'s card, with the variants of its key', async () => {
  const t = (await app.call('GET', '/api/envs/prod/trace?detail=full&service=session-gateway&ingress=in.revoke&scope=intra')).body;
  const p = storePanel(t, { group: 'redis:p81-sessions', collection: null })!;
  const by = Object.fromEntries(p.cards.map((c) => [c.title, c]));
  assert.deepEqual(p.cards.map((c) => c.title).sort(), ['auth:access:{userId}', 'auth:refresh:{userId}', 'auth:tcp:{userId}', 'session:{sessionId}']);
  assert.deepEqual(by['session:{sessionId}'].variants, ['session:${id}', 'sess:{sessionId}']);
  assert.deepEqual(by['auth:tcp:{userId}'].dbs, [2]);
  assert.deepEqual(by['auth:access:{userId}'].variants, []);
  assert.equal(p.keyCount, 4);
});

test('instance keys view: the key the multi-key step touches lists the revoke flow', async () => {
  const e = (k: string, db: number, commands: string[]) => ({ keyTemplate: k, dbIndex: db, service: 'session-gateway', commands });
  const put = await app.call('PUT', '/api/envs/prod/resources/redis%3Ap81-sessions/keys', { keys: [e('session:{sessionId}', 1, ['get', 'del']), e('auth:refresh:{userId}', 1, ['del']), e('auth:tcp:{userId}', 2, ['del'])], producer: 't' });
  assert.equal(put.status, 200);
  const r = (await app.call('GET', '/api/envs/prod/resources/redis%3Ap81-sessions/keys')).body;
  const rows = r.groups.flatMap((g: any) => g.rows), flows = (k: string) => rows.find((x: any) => x.keyTemplate === k)?.flows ?? [];
  assert.ok(flows('auth:refresh:{userId}').some((f: any) => f.ingress === 'in.revoke'));
  assert.ok(flows('auth:tcp:{userId}').some((f: any) => f.ingress === 'in.revoke'), 'the per-key db 2 matches the row of db 2');
  assert.ok(flows('session:{sessionId}').some((f: any) => f.ingress === 'in.validate') && flows('session:{sessionId}').some((f: any) => f.ingress === 'in.revoke'));
});
