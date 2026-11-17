// Version compare and the Drivers query (#130): tolerant parsing, range semantics, query words.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseVersion, compareVersions, satisfies, parseDriverQuery, formatDriverQuery, type VerOp } from '../core/versions.ts';

const V = (s: string) => parseVersion(s)!;
const vocab = { packages: ['mongoose', 'redis', 'ioredis', 'mongodb'], components: ['orders-svc', 'billing-svc'] };

test('parses ^ ~ v npm: and ranges; no major means undefined', () => {
  assert.deepEqual([V('5.3.2'), V('^4.27.6'), V('~4'), V('v5'), V('npm:ioredis@5.3.2'), V('>=5.1')].map((v) => [v.major, v.minor, v.patch, v.parts]),
    [[5, 3, 2, 3], [4, 27, 6, 3], [4, 0, 0, 1], [5, 0, 0, 1], [5, 3, 2, 3], [5, 1, 0, 2]]);
  for (const bad of ['latest', 'git+https://github.com/x/y.git#v5', 'https://x.test/a-5.tgz', 'file:../4.x', '', undefined, null, 'workspace:*']) assert.equal(parseVersion(bad), undefined, String(bad));
  assert.equal(V('5.0.0-beta.1').pre, 'beta.1');
});

test('compares majors first, then minor and patch, and a pre-release before its release', () => {
  const c = (a: string, b: string) => Math.sign(compareVersions(V(a), V(b)));
  assert.equal(c('4.28.5', '4.9.0'), 1);
  assert.equal(c('5.0.0', '4.99.99'), 1);
  assert.equal(c('4.27.6', '4.27.6'), 0);
  assert.equal(c('5.0.0-beta.1', '5.0.0'), -1);
  assert.deepEqual(['5.3.2', '4.28.5', '10.0.0', '4.9.0'].sort((a, b) => compareVersions(V(b), V(a))), ['10.0.0', '5.3.2', '4.28.5', '4.9.0']);
});

test('a condition is compared at the precision it was written', () => {
  const p = (op: VerOp, v: string) => ({ op, v: V(v), text: v });
  assert.ok(satisfies('5.13.20', p('<', '6')));
  assert.ok(!satisfies('6.0.1', p('<', '6')));
  assert.ok(satisfies('6.4.1', p('<=', '6')), '<= 6 includes 6.x');
  assert.ok(satisfies('3.1.2', p('=', '3')));
  assert.ok(!satisfies('4.0.0', p('=', '3')));
  assert.ok(satisfies('6.3.0', p('>', '6.2')));
  assert.ok(!satisfies('6.2.9', p('>', '6.2')));
  assert.ok(satisfies('4.28.5', p('=', '4.28.5')));
  assert.ok(!satisfies('4.28.6', p('=', '4.28.5')));
  assert.ok(satisfies('^4.1.0', p('>=', '4')), 'a ^ range counts by its floor');
  assert.ok(!satisfies('latest', p('<', '6')) && !satisfies(undefined, p('>=', '0')), 'no major matches nothing');
});

test('the query words become component, package and version conditions', () => {
  const q = (s: string) => parseDriverQuery(s, vocab);
  let r = q('mongoose < 6');
  assert.equal(r.package, 'mongoose'); assert.deepEqual(r.versions.map((p) => [p.op, p.v.major]), [['<', 6]]);
  r = q('redis 3'); assert.equal(r.package, 'redis'); assert.deepEqual(r.versions.map((p) => [p.op, p.v.major, p.v.parts]), [['=', 3, 1]]);
  for (const s of ['v3', '3.x', '3']) assert.deepEqual(q(s).versions.map((p) => [p.op, p.v.major]), [['=', 3]], s);
  r = q('>= 4 < 5'); assert.deepEqual(r.versions.map((p) => [p.op, p.v.major]), [['>=', 4], ['<', 5]]);
  r = q('ioredis >=4 <5'); assert.equal(r.package, 'ioredis'); assert.equal(r.versions.length, 2);
  r = q('orders-svc mongodb 6.3.0'); assert.equal(r.component, 'orders-svc'); assert.equal(r.package, 'mongodb'); assert.deepEqual([r.versions[0].op, r.versions[0].v.parts], ['=', 3]);
  r = q('Mongoose'); assert.equal(r.package, 'mongoose', 'case-insensitive, canonical name');
  r = q('payments'); assert.deepEqual(r.text, ['payments'], 'an unknown word stays text');
  assert.deepEqual(q(''), { versions: [], text: [] });
});

test('the query round-trips to the URL form', () => {
  for (const s of ['mongoose < 6', 'redis 3.x', 'orders-svc', '>= 4 < 5']) assert.equal(formatDriverQuery(parseDriverQuery(s, vocab)), s);
});
