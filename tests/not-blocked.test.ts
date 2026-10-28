// #96: `details.coverage.notBlocked` (calls into known packages: mongodb, amqplib/RabbitMQ). Demo: samples/group-admin.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { blockedSteps, coverageOf, traceBlocked } from '../core/incomplete.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS module shared with the browser
import { nbTitle } from '../web/js/views/incomplete-pure.js';

const g = buildIndex(sampleModel()), grp = { service: 'group-admin', ingress: 'in.patchGroup' };
const open = () => trace(g, grp, { scope: 'full', frontier: true, maxMessages: 100 })!;

test('coverageOf keeps notBlocked, drops malformed entries and non-string fields', () => {
  const c = coverageOf({ coverage: { blocked: 1, notBlocked: [{ fn: 'a', seq: 2, package: 'amqplib', label: 'RabbitMQ — not mapped yet', transport: 'RabbitMQ', line: 5, source: ['x', 7] }, { seq: 1 }, 'x', { fn: 'b', label: 9 }] } } as any)!;
  assert.deepEqual(c.notBlocked, [{ fn: 'a', seq: 2, package: 'amqplib', label: 'RabbitMQ — not mapped yet', transport: 'RabbitMQ', line: 5, source: ['x'] }, { fn: 'b', seq: 0 }]);
  assert.equal(coverageOf({ coverage: { notBlocked: [{ fn: 'a' }] } } as any)?.notBlocked?.length, 1);
  assert.equal(coverageOf({ coverage: { notBlocked: 'x' } } as any), null);
  assert.equal(nbTitle({ label: 'L', package: 'p' }), 'L');
});

test('coverageFor: the trace coverage carries notBlocked, links only http(s)', () => {
  const t = open();
  assert.deepEqual(t.coverage?.notBlocked?.map((e) => [e.package, e.transport]), [['mongodb', undefined], ['amqplib', 'RabbitMQ']]);
  assert.equal(t.coverage?.sites?.length, 1);
  for (const e of t.coverage!.notBlocked!) assert.ok(e.url === undefined || /^https?:/.test(e.url as string));
});

test('a frontier step matching notBlocked is a labelled leaf, not a gap, and not blocked', () => {
  const t = open();
  const leaves = t.messages.filter((m) => m.notBlocked);
  assert.deepEqual(leaves.map((m) => [m.kind, m.label, m.seq, m.notBlocked!.transport, m.gap, m.blocked]), [
    ['leaf', 'MongoDB driver call; the DB operations are mapped separately', 1, undefined, undefined, undefined],
    ['leaf', 'RabbitMQ — not mapped yet', 2, 'RabbitMQ', undefined, undefined]]);
  assert.ok(leaves.every((m) => m.from === m.to && m.over?.join() === 'group-admin'));
  assert.equal(t.messages.filter((m) => m.gap).length, 1);
  assert.deepEqual(blockedSteps(t).sites.map((s) => s.seq), [3]);
  assert.equal(traceBlocked(t, t.coverage).n, 1);
  const folded = trace(g, grp, { scope: 'full', maxMessages: 100 })!;
  assert.equal(folded.messages.find((m) => m.kind === 'frontier')?.frontierBlocked, 1);
});
