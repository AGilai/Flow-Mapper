// #86 store panel: the pure grouping and the registry join (core/store-panel.ts), the additive trace fields, and the panel's DOM (web/js/views/store-panel.js).
// Demo: samples/checkout-svc.json (Redis checkout-cache with three key templates and a step with no key, a Mongo collection with fields), samples/keys/prod.json (two of the keys).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { storePanel, accessClass, capSteps, matchRegistry, summary, ttlLine, targetOf, targetKey, DELETE_OPS } from '../core/store-panel.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS module shared with the browser
import { pressed, press, targetOfHead, isStoreHead, scrollPlan, flashMs, headLabel } from '../web/js/views/store-panel-pure.js';

const msg = (extra: any = {}): any => ({ from: 'a', to: 'b', label: 'get', mode: 'sync', kind: 'resource', depth: 1, store: 'redis:checkout-cache/x', storeKind: 'redis', access: 'read', service: 'svc', fn: 'f', ...extra });
const redis = (n: number, label: string, access: string | undefined, tpl: string | undefined, more: any = {}) => msg({ label, access, seq: n, ...(tpl ? { keyTemplate: tpl } : {}), ...(more.d ?? {}), ...more.m }); // 0.42.1: top-level keyTemplate, dbIndex, ttlSeconds, keyUnresolved
const tr = (messages: any[], code: any = {}): any => ({ messages, code, participants: [] });

test('groups per key template, ops per (access, op name), chips ascending, unreported card last', () => {
  const t = tr([msg({ kind: 'call', store: undefined }), redis(1, 'get', 'read', 'a:{id}'), redis(2, 'GET', 'read', 'a:{id}'), redis(3, 'set', 'write', 'a:{id}', { d: { ttlSeconds: 60, dbIndex: 0 } }), redis(4, 'get', 'read', undefined), redis(5, 'get', 'read', 'b:{id}')]);
  const p = storePanel(t, { group: 'redis:checkout-cache' })!;
  assert.deepEqual(p.cards.map((c) => c.title), ['a:{id}', 'b:{id}', null]);
  assert.equal(p.cards[2].kind, 'unreported');
  const a = p.cards[0];
  assert.deepEqual(a.ops.map((o) => [o.access, o.steps]), [['read', [2, 3]], ['write', [4]]]); // default numbering: place in the trace (the call is message 1)
  assert.equal(a.ops[0].op, 'get'); // shown as first harvested
  assert.equal(p.keyCount, 2); assert.equal(p.unreported, true); assert.equal(p.stepCount, 5); assert.equal(p.total, 6);
  assert.deepEqual(summary(p), ['This flow touches ', { b: '2 keys' }, ' in this store, in ', { b: '5 of 6 steps' }, '.', ' ', { b: '1 key' }, ' not reported.']);
});

test('scope: only the clicked store; every service of the trace counts; other kinds and groups are out', () => {
  const t = tr([redis(1, 'get', 'read', 'a'), msg({ store: 'redis:other/x', keyTemplate: 'z' }), msg({ store: 'postgres:db/t', storeKind: 'postgres' }), msg({ service: 'other-svc', keyTemplate: 'c', seq: 1 })]);
  const p = storePanel(t, { group: 'redis:checkout-cache' })!;
  assert.deepEqual(p.cards.map((c) => c.title), ['a', 'c']);
  assert.equal(storePanel(t, { group: 'postgres:db' }), null);
  assert.equal(storePanel(t, { group: 'redis:nope' }), null);
});

test('delete is derived from the op name of a write; reads and unknown access never are', () => {
  for (const op of ['DEL', 'unlink', 'deleteOne', 'findOneAndDelete', 'hdel', 'xdel', 'DEL order:{id}']) assert.equal(accessClass(msg({ label: op, access: 'write' })), 'delete', op);
  assert.equal(accessClass(msg({ label: 'del', access: 'read_write' })), 'delete');
  assert.equal(accessClass(msg({ label: 'del', access: 'read' })), 'read');
  assert.equal(accessClass(msg({ label: 'del', access: undefined })), 'unknown');
  assert.equal(accessClass(msg({ label: 'set', access: 'write' })), 'write');
  assert.equal(accessClass(msg({ label: 'getset', access: 'read_write' })), 'rw');
  assert.equal(accessClass(msg({ label: 'use', access: 'write' })), 'write');
  assert.ok(DELETE_OPS.has('srem') && DELETE_OPS.has('lrem') && DELETE_OPS.has('remove'));
});

test('db, TTL and the "not reported" reason', () => {
  const t = tr([redis(1, 'setex', 'write', 'k', { d: { ttlSeconds: 60, dbIndex: 2 } }), redis(2, 'set', 'write', 'k', { d: { ttlSeconds: 3600, dbIndex: 2 } }), redis(3, 'get', 'read', 'j', { d: { dbIndex: 2 } }),
    redis(4, 'get', 'read', undefined, { m: { keyUnresolved: ['key_unresolved:computed'] } }), redis(5, 'get', 'read', undefined, { m: { keyUnresolved: [{ reason: 'from_config' }] } })]);
  const p = storePanel(t, { group: 'redis:checkout-cache' })!;
  assert.equal(p.db, 2); assert.equal(p.sub, 'Redis instance · db 2');
  assert.deepEqual(ttlLine(p.cards[0].ttl), { text: '60 s / 3600 s', note: 'steps disagree' });
  assert.deepEqual(ttlLine(p.cards[1].ttl), { text: 'not reported', note: null });
  assert.deepEqual(ttlLine({ values: [3600] }), { text: '1 h', note: '3600 s' });
  assert.deepEqual(ttlLine({ values: [60] }), { text: '60 s', note: null });
  assert.equal(p.cards[2].reason, 'computed at runtime, from_config');
  const none = storePanel(tr([redis(1, 'get', 'read', undefined)]), { group: 'redis:checkout-cache' })!;
  assert.equal(none.cards[0].reason, null); assert.equal(none.db, null); assert.equal(none.sub, 'Redis instance');
  assert.deepEqual(summary(none), ['This flow touches this store in ', { b: '1 of 1 steps' }, ', with no key reported.']);
});

test('code links: one per distinct file:line, with the steps it serves; a step with no source has none', () => {
  const code = { 'step:svc:f#1': { file: 'a.ts', line: 3, url: 'https://x/a.ts#L3' }, 'step:svc:f#2': { file: 'a.ts', line: 3, url: 'https://x/a.ts#L3' }, 'step:svc:f#3': { file: 'b.ts', line: 9, url: 'javascript:alert(1)' } };
  const t = tr([redis(1, 'get', 'read', 'k'), redis(2, 'get', 'read', 'k'), redis(3, 'GET', 'read', 'k'), redis(4, 'get', 'read', 'k')], code);
  const op = storePanel(t, { group: 'redis:checkout-cache' })!.cards[0].ops[0];
  assert.deepEqual(op.links.map((l) => [l.key, l.steps, l.url]), [['a.ts:3', [1, 2], 'https://x/a.ts#L3'], ['b.ts:9', [3], null]]);
});

test('chips: the first 8, then +N more; expanded shows all', () => {
  const s = Array.from({ length: 11 }, (_, i) => i + 1);
  assert.deepEqual(capSteps(s, false), { shown: s.slice(0, 8), more: 3 });
  assert.deepEqual(capSteps(s, true), { shown: s, more: 0 });
  assert.deepEqual(capSteps(s.slice(0, 8), false), { shown: s.slice(0, 8), more: 0 });
});

test('step numbers come from the diagram when given; a message the diagram does not draw is left out', () => {
  const t = tr([redis(1, 'get', 'read', 'k'), redis(2, 'set', 'write', 'k')]);
  const p = storePanel(t, { group: 'redis:checkout-cache' }, { stepNo: (_m, i) => (i === 0 ? 7 : null), total: 12 })!;
  assert.deepEqual(p.cards[0].steps, [7]); assert.equal(p.total, 12);
});

test('Mongo: a card per collection, fields unioned by role and deduped, inDdl false kept', () => {
  const mg = (n: number, label: string, access: string, coll: string, fields: any[]) => msg({ seq: n, label, access, store: `mongodb:acc-db/${coll}`, storeKind: 'mongodb', fields });
  const t = tr([mg(1, 'findOne', 'read', 'accounts', [{ role: 'filter', path: 'email', operator: '$eq' }]), mg(2, 'findOne', 'read', 'accounts', [{ role: 'filter', path: 'email', operator: '$eq' }, { role: 'projection', path: 'name' }]),
    mg(3, 'updateOne', 'write', 'accounts', [{ role: 'update', path: 'lastLogin', operator: '$set', inDdl: false }, { role: 'filter', path: '_id' }]), mg(4, 'insertOne', 'write', 'audit', [])]);
  const one = storePanel(t, { group: 'mongodb:acc-db', collection: 'accounts' })!;
  assert.equal(one.cards.length, 1); assert.equal(one.title, 'accounts'); assert.equal(one.sub, 'acc-db · collection accounts'); assert.equal(one.folded, false);
  assert.deepEqual(one.cards[0].ops[0].fields.map((g) => [g.label, g.items.map((i) => i.path)]), [['filter', ['email']], ['project', ['name']]]);
  assert.deepEqual(one.cards[0].ops[1].fields.map((g) => [g.label, g.items]), [['filter', [{ path: '_id' }]], ['update', [{ path: 'lastLogin', operator: '$set', inDdl: false }]]]);
  assert.deepEqual(summary(one).slice(0, 3), ['This flow touches ', { b: '1 collection' }, ' in this store, in ']);
  const all = storePanel(t, { group: 'mongodb:acc-db' })!;
  assert.equal(all.folded, true); assert.equal(all.title, 'acc-db (2 collections)'); assert.deepEqual(all.cards.map((c) => c.title), ['accounts', 'audit']);
  assert.equal(targetKey({ group: 'mongodb:acc-db', collection: 'accounts' }), 'mongodb:acc-db/accounts');
});

test('store= of a link: a store the trace touches, else ignored', () => {
  const t = tr([redis(1, 'get', 'read', 'k'), msg({ store: 'mongodb:d/c', storeKind: 'mongodb' })]);
  assert.deepEqual(targetOf(t, 'redis:checkout-cache'), { group: 'redis:checkout-cache', collection: null });
  assert.deepEqual(targetOf(t, 'mongodb:d/c'), { group: 'mongodb:d', collection: 'c' });
  assert.equal(targetOf(t, 'mongodb:d/other'), null); assert.equal(targetOf(t, 'redis:gone'), null); assert.equal(targetOf(t, null), null);
});

test('registry join: exact template (case-sensitive), db must agree when both have one, no prefix match', () => {
  const groups = [{ kind: 'owner', owner: 'auth-svc', rows: [{ keyTemplate: 'session:{id}', dbIndex: 0, ttl: { seconds: 3600, values: [{ service: 'auth-svc', ttlSeconds: 3600 }], disagree: false }, writers: [{ service: 'auth-svc', access: 'read_write' }], readers: [{ service: 'gw', access: 'read' }] }] },
    { kind: 'shared', rows: [{ keyTemplate: 'rl:{k}', dbIndex: 1, ttl: { seconds: null, values: [{ service: 'a', ttlSeconds: 60 }, { service: 'b', ttlSeconds: 3600 }], disagree: true }, writers: [{ service: 'a', access: 'write' }, { service: 'b', access: 'write' }], readers: [] }] }];
  const m = matchRegistry(groups, 'session:{id}', [0])!;
  assert.deepEqual([m.owner, m.ttl, m.usedBy, m.description], ['auth-svc', '3600 s, all writers agree', 'auth-svc (read, write), gw (read)', null]);
  assert.equal(matchRegistry(groups, 'session:{id}', [1]), null);
  assert.ok(matchRegistry(groups, 'session:{id}', []));
  assert.equal(matchRegistry(groups, 'Session:{id}', [0]), null); assert.equal(matchRegistry(groups, 'session', [0]), null); assert.equal(matchRegistry(groups, null), null); assert.equal(matchRegistry(null, 'x'), null);
  const s = matchRegistry(groups, 'rl:{k}', [1])!;
  assert.deepEqual([s.owner, s.shared, s.ttl], ['shared', true, 'writers disagree: 60 s, 3600 s']);
});

test('end to end on the demo sample (needs the 0.42.1 trace fields; skipped before it)', (ctx) => {
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: 'checkout-svc', ingress: 'in.checkout' }, { scope: 'full', maxMessages: 800 })!;
  const res = t.messages.filter((m: any) => m.kind === 'resource' && m.storeKind === 'redis');
  if (!res.some((m: any) => m.keyTemplate)) return ctx.skip('trace has no top-level keyTemplate yet');
  const p = storePanel(t as any, { group: 'redis:checkout-cache' })!;
  assert.deepEqual(p.cards.map((c) => c.title), ['cart:{userId}', 'checkout:lock:{cartId}', 'checkout:idem:{key}', null]); // checkout:idem is sent as keyPattern: the alias
  assert.equal(p.cards[3].reason, 'computed at runtime'); // sent as the {unresolved:computed} value
  const mg = storePanel(t as any, { group: 'mongodb:checkout-db', collection: 'carts' })!;
  assert.ok(mg.cards[0].ops.some((o) => o.fields.length));
});

test('interaction rules: which heads are pressed, press toggles, chip scroll plan, flash length', () => {
  const redisHead = { kind: 'resource', group: 'redis:c', storeKind: 'redis', store: 'c', label: 'c', collection: 'tpl' }, coll = (n: string) => ({ kind: 'resource', group: 'mongodb:d', storeKind: 'mongodb', store: 'd', label: n, collection: n }), fold = { kind: 'resource', group: 'mongodb:d', storeKind: 'mongodb', stack: true };
  assert.ok(isStoreHead(redisHead) && isStoreHead(coll('a')) && !isStoreHead({ kind: 'resource', storeKind: 'postgres' }) && !isStoreHead({ kind: 'service' }));
  assert.deepEqual(targetOfHead(redisHead), { group: 'redis:c', collection: null }); assert.deepEqual(targetOfHead(coll('a')), { group: 'mongodb:d', collection: 'a' }); assert.deepEqual(targetOfHead(fold), { group: 'mongodb:d', collection: null });
  assert.equal(pressed(coll('a'), { group: 'mongodb:d', collection: 'a' }), true); assert.equal(pressed(coll('b'), { group: 'mongodb:d', collection: 'a' }), false);
  assert.equal(pressed(fold, { group: 'mongodb:d', collection: 'a' }), true); assert.equal(pressed(redisHead, { group: 'redis:c', collection: null }), true); assert.equal(pressed(redisHead, null), false);
  assert.deepEqual(press(null, { group: 'redis:c', collection: null }), { open: { group: 'redis:c', collection: null } });
  assert.deepEqual(press({ group: 'redis:c', collection: null }, { group: 'redis:c', collection: null }), { close: true });
  assert.ok('open' in press({ group: 'mongodb:d', collection: 'a' }, { group: 'mongodb:d', collection: 'b' }));
  assert.equal(scrollPlan({ top: 10, bottom: 30 }, { top: 0, bottom: 200 }), 'nearest'); assert.equal(scrollPlan({ top: 500, bottom: 520 }, { top: 0, bottom: 200 }), 'center'); assert.equal(scrollPlan({ top: -50, bottom: -20 }, { top: 0, bottom: 200 }), 'center');
  assert.equal(flashMs(false), 1500); assert.equal(flashMs(true), null);
  assert.equal(headLabel(redisHead), 'Show what this flow touches in c, redis'); assert.equal(headLabel(coll('accounts')), 'Show what this flow touches in accounts, mongodb');
});

test('#88: a folded run `*3 get, hget` is listed by its calls: each key and op counts, the chips read 5.1, 5.2, 5.3 and all jump to the run\'s step', () => {
  const call = (label: string, seq: number, tpl: string | null) => ({ label, store: 'redis:checkout-cache', access: label === 'get' ? 'read' : 'write', service: 'svc', fn: 'f', seq, ...(tpl ? { keyTemplate: tpl } : {}) });
  const run = msg({ label: '*3 get, hset', seq: 1, dbGroup: { count: 3, collections: ['checkout-cache'], access: 'read_write', members: ['k1', 'k2', 'k3'], calls: [call('get', 1, 'a:{id}'), call('hset', 2, 'a:{id}'), call('get', 3, 'b:{id}')] } });
  const t = tr([msg({ kind: 'call', store: undefined }), redis(1, 'get', 'read', 'a:{id}'), run], { 'step:svc:f#2': { file: 'x.ts', line: 7, url: 'https://x/x.ts#L7' } });
  const p = storePanel(t, { group: 'redis:checkout-cache' }, { stepNo: (_m, i) => i, total: 2 })!;
  assert.deepEqual(p.cards.map((c) => c.title), ['a:{id}', 'b:{id}']);
  assert.deepEqual(p.cards[0].ops.map((o) => [o.op, o.steps, o.chips]), [['get', [1, 2], [{ n: 1 }, { n: 2, sub: 1 }]], ['hset', [2], [{ n: 2, sub: 2 }]]]);
  assert.deepEqual(p.cards[1].ops[0].chips, [{ n: 2, sub: 3 }]);
  assert.deepEqual(p.cards[0].ops[1].links.map((l) => [l.key, l.steps]), [['x.ts:7', [2]]], 'a call keeps its own code link');
  assert.equal(p.stepCount, 2);
});

test('#88: the diagram maps the calls of a folded run (an ungrouped trace) to { n, sub }: chips n.sub, the run is one step', () => {
  const t = tr([redis(1, 'get', 'read', 'a:{id}'), redis(2, 'hget', 'read', 'a:{id}'), redis(3, 'get', 'read', 'b:{id}'), redis(4, 'set', 'write', 'a:{id}')]);
  const p = storePanel(t, { group: 'redis:checkout-cache' }, { stepNo: (_m, i) => (i < 3 ? { n: 5, sub: i + 1 } : 6), total: 6 })!;
  assert.deepEqual(p.cards[0].ops.map((o) => [o.op, o.steps, o.chips.map((c) => (c.sub ? `${c.n}.${c.sub}` : `${c.n}`))]), [['get', [5], ['5.1']], ['hget', [5], ['5.2']], ['set', [6], ['6']]]);
  assert.deepEqual(p.cards[1].ops[0].chips, [{ n: 5, sub: 3 }]);
  assert.equal(p.stepCount, 2);
});
