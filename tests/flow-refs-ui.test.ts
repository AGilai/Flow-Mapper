// 0.26.0: references in a flow (the head lock rule, the partial-flow line with the walk's step numbers), component colours,
// the client-app lane start, the empty (noHandler) lane and the stacked chips at a narrow width. Pure web modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { systemGraph } from '../core/system-graph.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { lockedServices, partialItems, partialLead, partialLabel, ingressOf } from '../web/js/views/flow-refs.js';
// @ts-ignore
import { slotOf } from '../web/js/design/component-colors.js';
// @ts-ignore
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { markChips, chipsStack } from '../web/js/views/flow-marks-draw.js';

const msg = (from: string, to: string, extra: any = {}) => ({ from, to, kind: 'egress', depth: 1, label: `${from}>${to}`, mode: 'sync', transport: 'http', ...extra });
const REF = { anchor: 'ing:users-svc/in.getPosture', source: 'prod' };

test('a head is locked only when every message into it is a reference (D6): auth-svc has a reference call but is not locked', () => {
  const t = { messages: [
    msg('client', 'svc:pop', { kind: 'entry' }), msg('svc:pop', 'svc:users', { reference: REF }), msg('svc:users', 'svc:users', { kind: 'call' }),
    msg('svc:pop', 'svc:auth'), msg('svc:users', 'svc:auth', { reference: { anchor: 'ing:auth/in.verify', source: 'prod' } }),
  ] };
  const locked = lockedServices(t);
  assert.deepEqual([...locked], [['users', 'prod']], 'users: its only entering message is a reference; a step inside it does not count');
  assert.ok(!locked.has('auth'), 'auth is reached by one plain call and one reference');
  assert.ok(!locked.has('pop'));
  assert.equal(lockedServices({ messages: [] }).size, 0);
  assert.equal(lockedServices(undefined).size, 0, 'a sealed trace has none');
});

test('ingressOf reads an endpoint anchor', () => {
  assert.deepEqual(ingressOf('ing:users-svc/in.getPosture'), { service: 'users-svc', ingress: 'in.getPosture' });
  assert.equal(ingressOf('svc:users-svc'), null);
});

test('the partial line: step numbers come from the walk, text says how many steps run into references', () => {
  const messages = [msg('client', 'svc:a', { kind: 'entry' }), msg('svc:a', 'svc:b'), msg('svc:a', 'svc:c', { reference: REF })];
  const steps = [{ n: 1, event: { msg: messages[1] } }, { n: 2, event: { msg: messages[2] } }];
  const partial = { steps: [{ message: 2, anchor: REF.anchor, service: 'users-svc', ingress: 'in.getPosture', label: 'http:GET users-svc/users/{id}/posture', source: 'prod' }] };
  const items = partialItems(partial, messages, steps);
  assert.equal(items[0].n, 2);
  assert.equal(partialLabel(items[0]), 'step 2 users-svc · GET /users/{id}/posture');
  assert.equal(partialLead(1), "Partial flow: 1 step continues into a reference, so their behaviour isn't in this design:");
  assert.match(partialLead(2), /^Partial flow: 2 steps continue into references/);
  assert.equal(partialItems(partial, messages, [steps[0]])[0].n, null, 'an arrow that is not a step now (hidden by depth) has no number');
  assert.deepEqual(partialItems(undefined, messages, steps), [], 'absent partial: nothing');
  assert.equal(partialLabel({ n: 4, service: 'activitylog', label: 'amqp-rpc:rpc.activitylog.log.append' }), 'step 4 activitylog · rpc.activitylog.log.append');
});

test('component colours: the slot from the env meta; client apps and infra stay neutral; a slot outside 1..8 is ignored', () => {
  const meta = [{ name: 'd', colors: { a: 3, b: 9, c: 1 } }];
  assert.equal(slotOf(meta, 'd', 'a', 'service'), 3);
  assert.equal(slotOf(meta, 'd', 'c', 'client-app'), null);
  assert.equal(slotOf(meta, 'd', 'c', 'infra'), null);
  assert.equal(slotOf(meta, 'd', 'b', 'service'), null);
  assert.equal(slotOf(meta, 'other', 'a', 'service'), null);
  assert.equal(slotOf(undefined, 'd', 'a', 'service'), null);
});

test('a client app starts its own lane: no client column, no entry arrow, head says "client app" and carries the trigger', () => {
  const participants = [{ id: 'client', kind: 'client', label: 'client' }, { id: 'svc:agent', kind: 'service', label: 'agent', service: 'agent', serviceKind: 'client-app' }, { id: 'svc:pop', kind: 'service', label: 'pop', service: 'pop', serviceKind: 'service' }];
  const msgs = [msg('client', 'svc:agent', { kind: 'entry', transport: 'other', service: 'agent', depth: 0 }), msg('svc:agent', 'svc:pop', { service: 'agent', mode: 'async' })];
  const lane = buildLane(msgs, { participants, trigger: 'user signs in' });
  assert.deepEqual(lane.columns.map((c: any) => c.label), ['agent', 'pop'], 'no client column');
  assert.equal(lane.columns[0].sub, 'client app');
  assert.equal(lane.columns[0].trigger, 'user signs in');
  assert.equal(lane.events.filter((e: any) => e.type === 'call').length, 1, 'only the agent -> pop arrow');
  assert.equal(lane.bars[0].start, 0, 'the first bar starts at the first row');
  const plain = buildLane(msgs, { participants: participants.map((p) => ({ ...p, serviceKind: 'service' })) });
  assert.equal(plain.columns.length, 3, 'a sealed or plain service keeps its caller column');
});

test('an entry point with no handler draws the caller and the component and no rows', () => {
  const lane = buildLane([], { participants: [{ id: 'client', kind: 'client', label: 'client' }, { id: 'svc:x', kind: 'service', label: 'x', service: 'x', serviceKind: 'service' }] });
  assert.deepEqual(lane.columns.map((c: any) => c.label), ['client', 'x']);
  assert.equal(lane.events.length, 0);
});

test('chips stack, one per line, when they do not fit beside the step tile; a single chip never stacks', () => {
  const marks = { arrow: () => ({ inDraft: true }) };
  const chips = markChips(marks, { transport: 'undecided' });
  assert.deepEqual(chips.map(([t]: any) => t), ['in draft', 'transport not decided']);
  assert.equal(chipsStack(chips, 150), true, 'at 760 px an arrow is about 150 long');
  assert.equal(chipsStack(chips, 420), false, 'a long arrow keeps them side by side');
  assert.equal(chipsStack(markChips(marks, { transport: 'http' }), 60), false);
});

test('the system map node carries the runtime of its header (#49), and only then', () => {
  const m = sampleModel(), svc = m.services[0];
  svc.details = { runtime: 'k8s-pod' };
  const nodes = systemGraph(buildIndex(m)).nodes;
  assert.equal(nodes.find((n: any) => n.service === svc.name)?.runtime, 'k8s-pod');
  const has = nodes.filter((n: any) => 'runtime' in n).map((n: any) => `${n.id}=${n.runtime}`).sort();
  assert.deepEqual(has, [`svc:${svc.name}=k8s-pod`, 'svc:analytics-svc=k8s-deployment'].sort(), 'the sample analytics-svc has one too; no other node has the key');
});
