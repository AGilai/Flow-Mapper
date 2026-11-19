import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
// @ts-ignore plain JS module shared with the browser
import { buildLane } from '../web/js/views/flow-lane.js';
function flow(app: string, drawnAt?: Map<string, number>) {
  const svc = (name: string, kind: string) => ({ name, kind, version: 1, harvestedAt: '2026-01-01' });
  const model: any = { env: 't', services: [svc('agent', app), svc('cm', 'client-app')],
    functions: [
      { service: 'agent', id: 'login', name: 'login', steps: [{ seq: 1, type: 'call', kind: 'leaf', operation: 'prep' }, { seq: 2, type: 'egress', target: 'ensure' }] },
      { service: 'agent', id: 'relay', name: 'relay', steps: [{ seq: 1, type: 'call', kind: 'leaf', operation: 'forward' }] },
      { service: 'cm', id: 'ensure', name: 'ensure', steps: [{ seq: 1, type: 'egress', target: 'back' }] }],
    ingress: [{ service: 'agent', id: 'in', bindKey: app === 'client-app' ? 'client:agent/login' : 'http:POST agent/login', transport: app === 'client-app' ? 'other' : 'http', handler: 'login', entryPoint: true },
      { service: 'agent', id: 'in.relay', bindKey: 'rpc:agent/relay', transport: 'rpc', handler: 'relay' },
      { service: 'cm', id: 'in.ensure', bindKey: 'rpc:cm/ensure', transport: 'rpc', handler: 'ensure' }],
    egress: [{ service: 'agent', id: 'ensure', bindKey: 'rpc:cm/ensure', transport: 'rpc', mode: 'async' }, { service: 'cm', id: 'back', bindKey: 'rpc:agent/relay', transport: 'rpc', mode: 'sync' }],
    resources: [], channels: [], bindings: [] };
  const t = trace(buildIndex(model), { service: 'agent', ingress: 'in' }, { scope: 'full', maxMessages: 100 })!;
  const lane = buildLane(t.messages, { participants: t.participants, drawnAt });
  return lane.bars.filter((b: any) => b.service === 'agent');
}
test('#147 a client app entry bar ends at its async call; the call back is a new level-0 bar after it', () => {
  const [entry, relay, ...rest] = flow('client-app');
  assert.equal(rest.length, 0);
  assert.equal(relay.level, 0, 'not nested');
  assert.ok(entry.end < relay.start, `entry ${entry.start}-${entry.end} ends before the relay ${relay.start}`);
});
test('#147 a sync entry (someone waits for its response) keeps its bar open: the call back nests, as before', () => {
  const [entry, relay] = flow('service');
  assert.equal(relay.level, 1);
  assert.ok(entry.end >= relay.end);
});
test('#147 the order=subsystem second pass (drawnAt) gives the same bars', () => {
  const [entry, relay, ...rest] = flow('client-app', new Map([['cm', 0], ['agent', 1]]));
  assert.equal(rest.length, 0);
  assert.equal(relay.level, 0);
  assert.ok(entry.end < relay.start);
});
