// The anchor grammar (core/anchors.ts): round trip of every kind, awkward keys, field suffix, bad input, parent chain.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { anchorOfRow, fieldAnchor, itemOf, parentOf, parseAnchor, rowOfAnchor } from '../core/anchors.ts';

const rows = [
  { service: 'auth-svc', list: 'header', key: '' },
  { service: 'auth-svc', list: 'functions', key: 'TokenController.device' },
  { service: 'auth-svc', list: 'ingress', key: 'in.token/device' },          // ids may hold '/'
  { service: 'auth-svc', list: 'egress', key: 'out.x' },
  { service: 'auth-svc', list: 'resources', key: 'res.db' },
  { service: 'auth-svc', list: 'bindings', key: 'b.1' },
  { service: 'auth-svc', list: 'channels', key: 'sns:tenant events/a b:c#d' }, // '/', ':', space, '#'
  { service: 'auth-svc', list: 'dto', key: 'in.token/device|response|404' },
  { service: 'auth-svc', list: 'dto', key: 'in.token|request|' },
  { service: '', list: 'event_dto', key: 'user.updated/v2' },
  { service: '', list: 'schema', key: 'mongodb:users-db/users|manual' },
  { service: 'auth-svc', list: 'flow', key: 'in.tunnel/open' },
];

test('every kind round-trips: row -> anchor -> row', () => {
  for (const r of rows) {
    const a = anchorOfRow(r);
    const back = rowOfAnchor(a, r.list === 'channels' ? r.service : undefined);
    assert.deepEqual(back, r, a);
    assert.equal(parseAnchor(a)!.field, undefined);
  }
});

test('anchor forms are exactly the documented ones', () => {
  assert.equal(anchorOfRow(rows[0]), 'svc:auth-svc');
  assert.equal(anchorOfRow(rows[2]), 'ing:auth-svc/in.token/device');
  assert.equal(anchorOfRow(rows[6]), 'ch:sns:tenant events/a b:c#d');
  assert.equal(anchorOfRow(rows[7]), 'dto:auth-svc/response/404/in.token/device');
  assert.equal(anchorOfRow(rows[8]), 'dto:auth-svc/request/-/in.token');
  assert.equal(anchorOfRow(rows[10]), 'schema:manual/mongodb:users-db/users');
});

test('field anchors: suffix after the last #, only on dto, evt and schema; channel keys keep their #', () => {
  const a = fieldAnchor('evt:UserUpdated', 'devices[].certFingerprint');
  assert.deepEqual(parseAnchor(a), { kind: 'evt', service: '', key: 'UserUpdated', field: 'devices[].certFingerprint' });
  assert.equal(itemOf(a), 'evt:UserUpdated');
  assert.deepEqual(rowOfAnchor(a), { service: '', list: 'event_dto', key: 'UserUpdated' });
  assert.equal(parseAnchor('ch:a#b')!.key, 'a#b');
  assert.equal(parseAnchor('ch:a#b')!.field, undefined);
  assert.equal(parseAnchor('dto:s/response/-/in.x#a.b')!.field, 'a.b');
});

test('bad input: null from parseAnchor, Error from rowOfAnchor', () => {
  for (const bad of ['', 'x', 'svc:', 'svc:a/b', 'fn:a', 'fn:/x', 'fn:a/', 'nope:a', 'dto:s/sideways/-/x', 'dto:s/request/x', 'schema:redis/key', 'schema:code', 'evt:', 'evt:a#']) {
    assert.equal(parseAnchor(bad), null, bad);
    assert.throws(() => rowOfAnchor(bad), /anchor/, bad);
  }
  assert.equal(parseAnchor(undefined), null);
});

test('ch: without a service gives an empty owner (the draft validator resolves it)', () => {
  assert.deepEqual(rowOfAnchor('ch:sns:t'), { service: '', list: 'channels', key: 'sns:t' });
});

test('parentOf: field -> parent field -> item -> svc -> null', () => {
  assert.equal(parentOf('evt:E#devices[].cert.fp'), 'evt:E#devices[].cert');
  assert.equal(parentOf('evt:E#devices[].cert'), 'evt:E#devices');
  assert.equal(parentOf('evt:E#devices'), 'evt:E');
  assert.equal(parentOf('evt:E'), null);
  assert.equal(parentOf('dto:s/request/-/in.x#a'), 'dto:s/request/-/in.x');
  assert.equal(parentOf('dto:s/request/-/in.x'), 'svc:s');
  assert.equal(parentOf('ing:s/in.x'), 'svc:s');
  assert.equal(parentOf('flow:s/in.x'), 'svc:s');
  assert.equal(parentOf('svc:s'), null);
  assert.equal(parentOf('ch:k'), null);
  assert.equal(parentOf('schema:manual/mongodb:db/c#a'), 'schema:manual/mongodb:db/c');
});
