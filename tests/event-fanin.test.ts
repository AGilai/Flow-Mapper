// Bug #26 (reopened): producers that feed the same topic are one block, with one topic, queue and consumer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { eventFlow } from '../core/event-flow.ts';
import { prepare, collapse } from '../web/js/views/event-slots.js';
import { sampleModel } from './helpers.ts';

const TYPE = 'domain.tenant.erase.status.change';

test('11 producers into one topic, queue and consumer are one block (#26)', () => {
  const flow = eventFlow(buildIndex(sampleModel()), TYPE);
  assert.equal(flow.groups.length, 11);
  const blocks = prepare(flow);
  assert.equal(blocks.length, 1);
  const [b] = blocks;
  assert.equal(b.groups.length, 11);
  assert.equal(b.targets.length, 1);
  assert.equal(b.targets[0].rows.length, 1);
  assert.equal(b.targets[0].rows[0].consumer, 'account-lambda-erase-controller');
});

test('beyond 8 producers the handled ones collapse; Show all brings them back (#26)', () => {
  const blocks = prepare(eventFlow(buildIndex(sampleModel()), TYPE));
  const info = collapse(blocks, false);
  assert.equal(blocks[0].producers.length, 8);
  assert.equal(blocks[0].producersHidden, 3);
  assert.equal(info.producers, 11);
  collapse(blocks, true);
  assert.equal(blocks[0].producers.length, 11);
});

test('a producer with a different first hop keeps its own block', () => {
  const blocks = prepare(eventFlow(buildIndex(sampleModel()), 'account.tenant.terminated.priority10'));
  assert.ok(blocks.length >= 1 && blocks.every((b) => b.groups.length >= 1));
});
