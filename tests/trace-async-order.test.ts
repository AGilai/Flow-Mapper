// #73: after an async call the caller continues. Its own later steps come right after the async call; the callee's subtree follows them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';

const model = (mode: 'async' | 'sync'): any => ({
  env: 'prod', channels: [], bindings: [], resources: [],
  services: [{ name: 'A', kind: 'service' }, { name: 'B', kind: 'service' }],
  functions: [
    { service: 'A', id: 'rotate', name: 'rotate', steps: [
      { seq: 1, type: 'egress', target: 'toB', mode },
      { seq: 2, type: 'call', target: 'deleteOld' },
      { seq: 3, type: 'call', target: 'finish' }] },
    { service: 'A', id: 'deleteOld', name: 'delete old certificate', steps: [] },
    { service: 'A', id: 'finish', name: 'finish', steps: [] },
    { service: 'B', id: 'onRotate', name: 'onRotate', steps: [{ seq: 1, type: 'call', target: 'work' }] },
    { service: 'B', id: 'work', name: 'work', steps: [] },
  ],
  ingress: [{ service: 'A', id: 'in.rotate', bindKey: 'http:POST /rotate', transport: 'http', handler: 'rotate' }, { service: 'B', id: 'in.b', bindKey: 'http:POST /b', transport: 'http', handler: 'onRotate' }],
  egress: [{ service: 'A', id: 'toB', bindKey: 'http:POST /b', transport: 'http', mode }],
});
const order = (mode: 'async' | 'sync') => trace(buildIndex(model(mode)), { service: 'A', ingress: 'in.rotate' }, { scope: 'full' })!.messages.map((m) => `${m.kind}:${m.label}`);

test('async call: the caller\'s later steps come before the callee\'s subtree', () => {
  const o = order('async');
  const i = (s: string) => o.findIndex((x) => x.includes(s));
  assert.ok(i('work') >= 0, o.join('\n'));
  assert.ok(i('delete old certificate') < i('work'), o.join('\n'));
  assert.ok(i('finish') < i('work'), o.join('\n'));
  assert.ok(o.findIndex((x) => x.startsWith('egress')) < i('delete old certificate'), 'the async arrow itself stays first');
});

test('sync call: unchanged, the callee\'s subtree comes first', () => {
  const o = order('sync');
  const i = (s: string) => o.findIndex((x) => x.includes(s));
  assert.ok(i('work') < i('delete old certificate'), o.join('\n'));
});
