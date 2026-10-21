// Field-level diff (QA D5, D6): DTOs, event DTOs, store schemas; JSON Schema and example JSON; roll-up phrases.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffFields, fieldsOf } from '../core/diff/fields.ts';
import { diff, marksOf, mini, mut } from './diff-helpers.ts';

const dm = (a: unknown, b: unknown) => diffFields(fieldsOf(a), fieldsOf(b));
const base = mini();
const evt = (f: (c: any) => void) => mut(mini(), '', 'event_dto', 'UserUpdated', (d) => f(d.content));
const dto = (f: (c: any) => void) => mut(mini(), 'users-svc', 'dto', 'in.getUser|response|', (d) => f(d.content));

test('D5 new, removed and changed type (was string)', () => {
  const m = dm({ a: 'x', b: 1, c: true }, { a: 'x', b: 'one', d: 2 });
  assert.deepEqual(m.map((x) => [x.path, x.mark, x.was]), [['b', 'changed', 'was number'], ['c', 'removed', undefined], ['d', 'new', undefined]]);
});

test('D5 nested objects: a new object marks itself, its children carry none', () => {
  assert.deepEqual(dm({ a: 1 }, { a: 1, o: { x: 1, y: { z: 2 } } }).map((x) => x.path), ['o']);
  assert.deepEqual(dm({ o: { x: 1, y: 2 } }, { o: { x: 1 } }).map((x) => [x.path, x.mark]), [['o.y', 'removed']]);
  assert.deepEqual(dm({ o: { x: 1, y: 2 } }, {}).map((x) => x.path), ['o']);
});

test('D5 array of objects: devices[].certFingerprint is marked, and unmarked under a new devices', () => {
  const m = dm({ devices: [{ id: 'd' }] }, { devices: [{ id: 'd', certFingerprint: 'f' }] });
  assert.deepEqual(m.map((x) => [x.path, x.mark]), [['devices[].certFingerprint', 'new']]);
  assert.deepEqual(dm({}, { devices: [{ id: 'd', certFingerprint: 'f' }] }).map((x) => x.path), ['devices']);
  assert.deepEqual(dm({ devices: [{ id: 'a' }] }, { devices: [{ id: 'a' }, { id: 'b', extra: 1 }] }).map((x) => x.path), ['devices[].extra']);
});

test('D5 JSON Schema: enum values (+ quarantined, − legacy), required, type; and a schema vs example is not confused', () => {
  const schema = (status: string[], required: string[], type = 'string') => ({ $schema: 'x', type: 'object', required, properties: { status: { type: 'string', enum: status }, n: { type } } });
  const m = dm(schema(['active', 'legacy'], []), schema(['active', 'quarantined'], ['status', 'n'], 'integer'));
  const by = Object.fromEntries(m.map((x) => [x.path, x]));
  assert.equal(by.status.was, '+ quarantined; − legacy; now required');
  assert.equal(by.n.was, 'was string; now required');
  assert.deepEqual(dm({ $schema: 'x', type: 'object', properties: { a: { type: 'string' } } }, { $schema: 'x', type: 'object', properties: { a: { type: 'string' }, b: { type: 'string' } } }).map((x) => x.path), ['b']);
});

test('D5 reordered keys and changed example values are no field change', () => {
  assert.deepEqual(dm({ a: 'x', b: { c: 1, d: 2 } }, { b: { d: 5, c: 9 }, a: 'y' }), []);
});

test('D5 event DTO field change rolls up to the producer component with the frame phrase', () => {
  const m = diff(base, evt((c) => { c.quarantineReason = 'x'; }));
  assert.deepEqual(marksOf(m), { 'evt:UserUpdated': 'changed', 'evt:UserUpdated#quarantineReason': 'new', 'grp:platform': 'changed', 'svc:users-svc': 'changed' });   // 0.28: and its subsystem
  assert.equal(m.marks['svc:users-svc'].what, 'message UserUpdated: 1 new field');
  assert.equal(m.marks['evt:UserUpdated'].what, '1 new field');
  assert.deepEqual([m.counts.messages.changed, m.counts.fields.new, m.counts.components.changed], [1, 1, 1]);
});

test('D5 endpoint DTO change rolls up to ing: and svc:', () => {
  const m = diff(base, dto((c) => { c.email = 5; }));
  assert.deepEqual(marksOf(m), { 'dto:users-svc/response/-/in.getUser': 'changed', 'dto:users-svc/response/-/in.getUser#email': 'changed', 'grp:platform': 'changed', 'ing:users-svc/in.getUser': 'changed', 'svc:users-svc': 'changed' });   // 0.28: and its subsystem
  assert.equal(m.marks['dto:users-svc/response/-/in.getUser#email'].was, 'was string');
  assert.equal(m.marks['ing:users-svc/in.getUser'].what, 'message response: 1 changed field');
  assert.equal(m.marks['svc:users-svc'].what, 'message response of in.getUser: 1 changed field');
  assert.equal(m.counts.endpoints.changed, 1);
});

test('D6 collection schema field: rolls up to each component with a resource on that store', () => {
  const m = diff(base, mut(mini(), '', 'schema', 'mongodb:users-db/users|manual', (d) => { d.fields.certFingerprint = 'string'; }));
  assert.equal(m.marks['schema:manual/mongodb:users-db/users#fields.certFingerprint'].mark, 'new');
  assert.equal(m.marks['svc:users-svc'].what, 'collection users: 1 new field');
  assert.equal(m.marks['svc:auth-svc'], undefined);
});

test('a new or removed message is one mark on the item (no field marks)', () => {
  const cur = mini().filter((r) => r.list !== 'event_dto');
  const m = diff(base, cur);
  assert.equal(m.marks['evt:UserUpdated'].mark, 'removed');
  assert.equal(m.ghosts['evt:UserUpdated'].label, 'UserUpdated');
  assert.equal(m.marks['svc:users-svc'].what, '−1 message');
});
