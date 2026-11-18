// CR #136: the pure parts of the store panel's collapsible cards (core/store-cards.ts): R/W marks, the order of the operations, the field tree of a schema, the key facts of a Redis card.
// Demo: samples/identity-svc.json (auditExport: 7 collections of identity-db), samples/schemas/prod.json (users, audit_events).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rwOf, sortOps, cardCounts, schemaTree, countFields, touchedPaths, templateParts, inferType, keyFacts, plural } from '../core/store-cards.ts';

const op = (access: string, name: string, steps: number[], fields: any[] = [], links: any[] = []): any => ({ access, op: name, steps, chips: steps.map((n) => ({ n })), links, fields });

test('R / W: reads light R, writes and deletes light W, rw both, unknown none', () => {
  assert.deepEqual(rwOf({ ops: [op('read', 'find', [1])] }), { r: true, w: false });
  assert.deepEqual(rwOf({ ops: [op('delete', 'deleteOne', [1])] }), { r: false, w: true });
  assert.deepEqual(rwOf({ ops: [op('read', 'find', [1]), op('write', 'insertOne', [2])] }), { r: true, w: true });
  assert.deepEqual(rwOf({ ops: [op('rw', 'findOneAndUpdate', [1])] }), { r: true, w: true });
  assert.deepEqual(rwOf({ ops: [op('unknown', 'x', [1])] }), { r: false, w: false });
});

test('operations: writes (and deletes) first, then by first step; the input is not changed', () => {
  const ops = [op('read', 'findById', [4]), op('read', 'find', [2]), op('delete', 'deleteMany', [9]), op('write', 'updateOne', [7])];
  assert.deepEqual(sortOps(ops).map((o) => o.op), ['updateOne', 'deleteMany', 'find', 'findById']);
  assert.deepEqual(ops.map((o) => o.op), ['findById', 'find', 'deleteMany', 'updateOne']);
});

test('counts and plural', () => {
  assert.deepEqual(cardCounts({ ops: [op('read', 'a', [1]), op('read', 'b', [2])], steps: [1, 2, 3] }), { calls: 2, steps: 3 });
  assert.equal(plural(1, 'step'), '1 step'); assert.equal(plural(3, 'step'), '3 steps');
});

test('schema tree: nested objects, arrays of objects, arrays of scalars, required, notes, touched fields', () => {
  const content = { type: 'object', required: ['_id', 'log'], properties: {
    _id: { type: 'ObjectId', description: 'primary key' },
    status: { type: 'string', enum: ['queued', 'done'] },
    owner: { type: 'Account' },
    spec: { type: 'object', properties: { env: { type: 'object', properties: { name: { type: 'string' } } } } },
    log: { type: 'array', items: { type: 'object', properties: { at: { type: 'date' }, line: { type: 'string' } } } },
    artifacts: { type: 'array', items: { type: 'string' } } } };
  const t = schemaTree(content, ['status', 'log.line', 'spec.env.name']);
  const by = Object.fromEntries(t.map((n) => [n.name, n]));
  assert.deepEqual(t.map((n) => n.name), ['_id', 'status', 'owner', 'spec', 'log', 'artifacts']);
  assert.equal(by._id.required, true); assert.equal(by._id.note, 'primary key'); assert.equal(by.status.required, false);
  assert.equal(by.status.note, 'queued | done'); assert.equal(by.status.used, true); assert.equal(by._id.used, false);
  assert.equal(by.owner.kind, 'ref'); assert.equal(by._id.kind, '');
  assert.equal(by.spec.kind, 'obj'); assert.equal(by.spec.children[0].children[0].path, 'spec.env.name');
  assert.equal(by.spec.used, true, 'a parent of a touched field is touched');
  assert.equal(by.log.kind, 'arr'); assert.equal(by.log.type, 'object[]'); assert.deepEqual(by.log.children.map((n) => n.name), ['at', 'line']);
  assert.equal(by.log.children[1].used, true); assert.equal(by.log.children[0].used, false);
  assert.equal(by.artifacts.type, 'string[]'); assert.equal(by.artifacts.children.length, 0);
  assert.equal(countFields(t), 10);
});

test('schema tree: the manual {fields} shape and a schema with no fields', () => {
  const t = schemaTree({ fields: { actor: 'string', roles: 'ObjectId[]', detail: { type: 'object', fields: { ip: 'string' } } } });
  assert.deepEqual(t.map((n) => [n.name, n.type, n.kind]), [['actor', 'string', ''], ['roles', 'ObjectId[]', 'arr'], ['detail', 'object', 'obj']]);
  assert.equal(t[2].children[0].path, 'detail.ip');
  assert.deepEqual(schemaTree({ note: 'described in the HLD', doc: { file: 'x.md' } }), []);
  assert.deepEqual(schemaTree(null), []);
});

test('the sample schemas of identity-db read as trees', async () => {
  const { readFileSync } = await import('node:fs');
  const all = JSON.parse(readFileSync(new URL('../samples/schemas/prod.json', import.meta.url), 'utf8')).schemas;
  const users = schemaTree(all.find((s: any) => s.key === 'mongodb:identity-db/users').content);
  assert.equal(users.find((n) => n.name === 'profile')!.children.find((n) => n.name === 'avatar')!.children.length, 2);
  assert.equal(users.find((n) => n.name === 'email')!.required, true);
  assert.ok(schemaTree(all.find((s: any) => s.key === 'mongodb:identity-db/audit_events').content).length >= 4);
});

test('touched paths of a card are the fields of all its operations, once', () => {
  const g = (...p: string[]) => [{ role: 'filter', label: 'Filter', items: p.map((path) => ({ path })) }];
  assert.deepEqual(touchedPaths({ ops: [op('read', 'find', [1], g('a', 'b')), op('write', 'updateOne', [2], g('b', 'c.d'))] }), ['a', 'b', 'c.d']);
});

test('Redis key: template parts, type from the operations, TTL and where it is set', () => {
  assert.deepEqual(templateParts('sess:{accountId}:{token}'), [{ text: 'sess:', ph: false }, { text: '{accountId}', ph: true }, { text: ':', ph: false }, { text: '{token}', ph: true }]);
  assert.equal(inferType([{ op: 'HGETALL' }]), 'hash'); assert.equal(inferType([{ op: 'LPUSH' }]), 'list'); assert.equal(inferType([{ op: 'INCR' }]), 'string (counter)'); assert.equal(inferType([{ op: 'frobnicate' }]), null);
  const card: any = { template: 'sess:{id}', dbs: [0], variants: ['sess:{x}'], ttl: { values: [3600] }, ops: [op('read', 'GET', [1]), op('write', 'SET', [2], [], [{ key: 'src/login.ts:134', steps: [2], url: null }])] };
  const k = keyFacts(card);
  assert.equal(k.type, 'string'); assert.equal(k.ttl!.text, '1 h'); assert.equal(k.setBy, 'src/login.ts:134'); assert.deepEqual(k.dbs, [0]); assert.deepEqual(k.variants, ['sess:{x}']);
  assert.equal(keyFacts({ ...card, ttl: { values: [] } }).ttl, null);
});
