// A delivery is expanded once per trace (#43): later repeats of the same (consumer, ingress, event) are one marker.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';

const run = (opts: object = {}) => trace(buildIndex(sampleModel()), { service: 'erase-saga-demo', ingress: 'in.start' }, { scope: 'full', ...opts })!;
const toStatus = (t: any) => t.messages.filter((m: any) => m.kind === 'deliver' && m.target?.fn === 'on_status' && !m.cycle);

test('three sibling publishes of one event: the controller saga is expanded under the first only', () => {
  const t = run();
  const d = toStatus(t);
  assert.equal(d.length, 3, 'every delivery is still drawn (the fan-out stays visible)');
  const first = t.messages.indexOf(d[0]) + 1;
  assert.equal(d[0].repeatOf, undefined);
  assert.deepEqual(d.slice(1).map((m: any) => m.repeatOf), [first, first]);
  assert.match(d[1].label, new RegExp(`↩ seen at step ${first}$`));
  assert.equal(t.messages.filter((m: any) => m.egress === 'advance.publish' && !m.from.startsWith('ch:') && m.fn === 'on_status').length, 1, 'the controller publishes once');
  for (const m of d.slice(1)) {
    const next = t.messages[t.messages.indexOf(m) + 1];
    assert.ok(!next || next.depth <= m.depth, 'nothing is expanded below a repeat');
  }
});

test('ancestor cycles keep their [cycle] marker; repeats do not count toward maxMessages', () => {
  const t = run();
  assert.ok(t.messages.some((m) => m.cycle && m.target?.fn === 'on_status'), 'the eraser publishes back into the controller on the path');
  assert.ok(!t.messages.some((m) => m.cycle && m.repeatOf));
  const n = t.messages.filter((m) => !m.repeatOf).length;
  const capped = run({ maxMessages: n });
  assert.equal(capped.truncated, false);
  assert.equal(capped.messages.length, t.messages.length);
});
