// The environment line in the rail, name rules, the New environment sentence (web/js/env-info.js), and the groupPath / client-app schema fields.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS module shared with the browser
import { envLine, shortDate, nameError, keyFromLabel, summarySentence, carryText, metaOf, defaultEnv, canDeleteEnv, deleteConfirmed } from '../web/js/env-info.js';
import { validateManifest } from '../server/schema.ts';
import { readSample } from './helpers.ts';

test('the rail line says sealed with the count, or design with its source and date', () => {
  assert.equal(envLine({ kind: 'sealed', counts: { components: 55 } }), 'sealed · 55 components');
  assert.equal(envLine({ kind: 'sealed', counts: { components: 1 } }), 'sealed · 1 component');
  assert.equal(envLine({ kind: 'design', source: 'prod', copiedAt: '2026-10-21T14:02:00Z' }), 'design · from prod, Oct 21');
  assert.equal(envLine({ kind: 'design', source: 'prod', copiedAt: null }), 'design · from prod');
  assert.equal(shortDate('nope'), '');
  assert.equal(metaOf([], 'x').kind, 'sealed');
});

test('name rules match the server, and subsystem keys come from labels', () => {
  assert.equal(nameError('', []), '');
  assert.equal(nameError('sase-hld', ['prod']), '');
  assert.match(nameError('Sase', []), /lowercase/);
  assert.match(nameError('a/b', []), /lowercase/);
  assert.match(nameError('prod', ['prod']), /already exists/);
  assert.match(nameError('meta', []), /reserved/);
  assert.equal(keyFromLabel('Network (POP)'), 'network-pop');
  assert.equal(keyFromLabel('  !!  '), '');
});

test('the summary sentence counts what comes along and says functions and flows stay', () => {
  const rows = [{ counts: { endpoints: 6, calls: 2, channels: 1, stores: 1, dtos: 9 } }, { counts: { endpoints: 8, calls: 0, channels: 2, stores: 2, dtos: 12 } }];
  const s = summarySentence({ mode: 'components', source: 'prod', rows, all: 55, groups: [{ key: 'platform', label: 'Platform' }] });
  assert.match(s, /^Copies 2 components into platform: 14 endpoints, 2 calls, 3 queues and topics, 3 data stores, 21 DTOs, as of prod now\./);
  assert.match(s, /functions and flows stay in prod/);
  assert.match(summarySentence({ mode: 'components', source: 'prod', rows, all: 55, groups: [{ key: 'a', label: 'A' }], unassigned: 2 }), /2 picked components have no subsystem yet\./);
  assert.doesNotMatch(summarySentence({ mode: 'components', source: 'prod', rows, all: 55, groups: [], unassigned: 2 }), /no subsystem/);
  assert.match(summarySentence({ mode: 'components', source: 'prod', rows: [], all: 5, groups: [] }), /Pick at least one/);
  assert.match(summarySentence({ mode: 'full', source: 'prod', rows: [], all: 55, groups: [] }), /55 components with their functions, flows and descriptions/);
  assert.match(summarySentence({ mode: 'blank', source: 'prod', rows: [], all: 0, groups: [] }), /empty/);
  assert.equal(carryText({ endpoints: 6, calls: 0, channels: 1, stores: 0, dtos: 9 }), '6 endpoints · 1 queue or topic · 9 DTOs');
});

test('a service may carry a groupPath and be a client-app; a bad path is refused', () => {
  const m = readSample('users-svc.json');
  assert.deepEqual(validateManifest({ ...m, service: { ...m.service, groupPath: 'platform/identity', kind: 'client-app' } }), []);
  assert.notEqual(validateManifest({ ...m, service: { ...m.service, groupPath: 'Platform Team' } }).length, 0);
  assert.notEqual(validateManifest({ ...m, service: { ...m.service, kind: 'client' } }).length, 0);
});

test('Delete environment is offered for design envs only, not the default or the last one; the confirm needs the exact name (#78)', () => {
  const envs = ['prod', 'hld', 'dev'];
  assert.equal(defaultEnv(envs), 'prod');
  assert.equal(defaultEnv(['b', 'a']), 'b');
  assert.equal(canDeleteEnv({ name: 'hld', kind: 'design' }, envs), true);
  assert.equal(canDeleteEnv({ name: 'dev', kind: 'sealed' }, envs), false);
  assert.equal(canDeleteEnv({ name: 'prod', kind: 'design' }, envs), false);
  assert.equal(canDeleteEnv({ name: 'x', kind: 'design' }, ['x']), false);
  assert.equal(canDeleteEnv({ name: 'x', kind: 'design' }, ['x', 'y']), false, 'x is the default when there is no prod');
  assert.equal(canDeleteEnv(undefined, envs), false);
  assert.equal(deleteConfirmed('hld', 'hld'), true);
  assert.equal(deleteConfirmed(' hld ', 'hld'), true);
  assert.equal(deleteConfirmed('HLD', 'hld'), false);
  assert.equal(deleteConfirmed('', 'hld'), false);
});
