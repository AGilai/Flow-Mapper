// Mermaid, the pure parts (0.27.2): the parser's corpus, the matcher, the label rules and the mapping to edits (core/mermaid-*.ts).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseMermaid, summarize } from '../core/mermaid-parse.ts';
import { componentName, defaultChoices, distance, looksInfra, matchParticipants, normalize } from '../core/mermaid-match.ts';
import { mermaidPlan, readLabel, resolveTargets } from '../core/mermaid-edits.ts';
import { exportMermaid, messageLabel } from '../core/mermaid-export.ts';
import { applyOp, opRow } from '../core/draft-ops.ts';
import { rowId, type ItemRow } from '../core/item-rows.ts';

test('parser: every arrow kind, with its meaning', () => {
  const p = parseMermaid(['sequenceDiagram', 'A->>B: sync', 'B-->>A: back', 'A-)B: async', 'B--)A: async dotted', 'A->B: open', 'B-->A: open dotted', 'A-xB: lost', 'B--xA: lost dotted'].join('\n'));
  assert.deepEqual(p.messages.map((m) => m.kind), ['sync', 'return', 'async', 'async', 'sync', 'return', 'sync', 'return']);
  assert.deepEqual(p.participants.map((x) => x.id), ['A', 'B']);
  assert.equal(p.warnings.length, 0);
});

test('parser: participants, actors, aliases, title, description, <br/> and entities', () => {
  const p = parseMermaid(['%% Flow: x', '%% Description: first line', '%% second line', 'sequenceDiagram', 'title: My flow', 'actor U as The User', 'participant S as pop-edge<br/>svc', 'create participant N as new one', 'U->>S: a#59; b #35;1'].join('\n'));
  assert.equal(p.title, 'My flow'); assert.equal(p.description, 'first line\nsecond line');
  assert.deepEqual(p.participants.map((x) => [x.id, x.label, x.actor]), [['U', 'The User', true], ['S', 'pop-edge svc', false], ['N', 'new one', false]]);
  assert.equal(p.messages[0].label, 'a; b #1');
});

test('parser: activation marks, notes, autonumber and comments', () => {
  const p = parseMermaid(['sequenceDiagram', 'autonumber', '%% a comment', 'A->>+B: call', 'activate B', 'Note over A,B: shared note', 'Note right of B: side', 'B-->>-A: done', 'deactivate A'].join('\n'));
  assert.equal(p.messages.length, 2); assert.equal(p.warnings.length, 0);
  assert.deepEqual(p.notes.map((n) => [n.over, n.text, n.after]), [[['A', 'B'], 'shared note', 1], [['B'], 'side', 1]]);
});

test('parser: blocks label the messages inside them; else switches the branch; rect and box are ignored with a warning', () => {
  const p = parseMermaid(['sequenceDiagram', 'A->>B: first', 'alt valid token', 'B->>C: ok', 'else expired', 'B->>C: refresh', 'end', 'loop each device', 'A->>B: poll', 'end', 'rect rgb(0,0,0)', 'A->>B: tinted', 'end', 'A->>B: after'].join('\n'));
  assert.deepEqual(p.messages.map((m) => m.block), [undefined, 'alt: valid token', 'else: expired', 'loop: each device', undefined, undefined]);
  assert.equal(p.warnings.length, 1); assert.match(p.warnings[0].text, /rect/);
});

test('parser: malformed lines are warnings with their line number, never a throw', () => {
  const p = parseMermaid(['A->>B: before the header', 'sequenceDiagram', 'this is not mermaid', 'A ->> : no callee', 'end', 'alt open', 'A->>B: x'].join('\n'));
  assert.equal(p.messages.length, 2);
  const lines = p.warnings.map((w) => w.line);
  assert.ok(lines.includes(1) && lines.includes(3) && lines.includes(5), JSON.stringify(p.warnings));
  assert.ok(p.warnings.some((w) => /not closed/.test(w.text)));
  assert.doesNotThrow(() => parseMermaid(''));
  assert.deepEqual(summarize(parseMermaid('sequenceDiagram\nA->>B: x\nB-->>A: y')), { participants: 2, actors: 0, messages: 1, returns: 1, notes: 0, warnings: 0 });
});

test('matcher: exact, alias, normalized, similar, in prod, actor, infra; the defaults', () => {
  const here = ['pop-edge', 'auth-svc', 'users-svc', 'cp-middleware'], src = ['pop-edge', 'audit-log-svc', 'payments-svc'];
  const rows = matchParticipants([
    { id: 'pop-edge', label: 'pop-edge', actor: false }, { id: 'P', label: 'users-svc', actor: false }, { id: 'A', label: 'AuthService', actor: false },
    { id: 'C', label: 'cp-middlewre', actor: false }, { id: 'L', label: 'Audit Log Service', actor: false }, { id: 'N', label: 'policy-engine', actor: false },
    { id: 'U', label: 'Agent', actor: true }, { id: 'D', label: 'sns:order-events', actor: false }, { id: 'S', label: 'orders-db.orders', actor: false },
  ], here, src);
  assert.deepEqual(rows.map((r) => [r.how, r.match ?? r.source ?? null]), [['exact', 'pop-edge'], ['alias', 'users-svc'], ['normalized', 'auth-svc'], ['similar', 'cp-middleware'], ['in-prod', 'audit-log-svc'], ['none', null], ['actor', null], ['infra', null], ['infra', null]]);
  assert.deepEqual(defaultChoices(rows), {
    'pop-edge': { component: 'pop-edge' }, P: { component: 'users-svc' }, A: { component: 'auth-svc' }, C: { component: 'cp-middleware' },
    L: { create: true, name: 'audit-log-svc' }, N: { create: true, name: 'policy-engine' }, U: { client: true }, D: { skip: true }, S: { skip: true },
  });
});

test('matcher: a close spelling needs to be the only one; the helpers', () => {
  const r = matchParticipants([{ id: 'x', label: 'user-api', actor: false }], ['users-api', 'user-app'], []);
  assert.equal(r[0].how, 'none', 'two components are one edit away: no guess');
  assert.equal(normalize('Auth_Service'), 'auth'); assert.equal(normalize('users svc'), 'users'); assert.equal(distance('kitten', 'sitting'), 3);
  assert.equal(componentName('Policy Engine'), 'policy-engine'); assert.equal(componentName('riskScorer'), 'risk-scorer');
  assert.ok(looksInfra('sqs:queue') && looksInfra('risk:{customer}') && !looksInfra('pop-edge') && !looksInfra('email provider'));
});

test('labels: METHOD /path is http, anything else is undecided with the label as operation; "Op: text" keeps the text as the step note', () => {
  assert.deepEqual(readLabel('POST /token', 'auth-svc'), { transport: 'http', bindKey: 'http:POST auth-svc/token' });
  assert.deepEqual(readLabel('get /users/{id}: loads it', 'users-svc'), { transport: 'http', bindKey: 'http:GET users-svc/users/{id}', text: 'loads it' });
  assert.deepEqual(readLabel('Evaluate', 'policy-engine'), { transport: 'undecided', bindKey: 'tbd:policy-engine/Evaluate', operation: 'Evaluate' });
  assert.deepEqual(readLabel('Score: risk of the device', 'risk-scorer'), { transport: 'undecided', bindKey: 'tbd:risk-scorer/Score', operation: 'Score', text: 'risk of the device' });
  assert.equal(messageLabel({ label: 'POST /verify http:POST auth-svc/verify', transport: 'http' } as any), 'POST /verify');
});

const header = (service: string, extra: object = {}): ItemRow => ({ service, list: 'header', key: '', data: { kind: 'service', ...extra } });
const TEXT = ['sequenceDiagram', 'title Tunnel', 'actor Agent', 'participant P as pop-edge', 'participant PE as policy-engine', 'Agent->>P: open tunnel: the agent starts', 'P->>PE: Evaluate', 'Note over P,PE: decides', 'alt allowed', 'P->>PE: POST /audit', 'end'].join('\n');

test('edits: components, endpoints, calls, notes and the flow; a second run over the result adds nothing', () => {
  const rows = [header('pop-edge')];
  const parsed = parseMermaid(TEXT), m = matchParticipants(parsed.participants, ['pop-edge'], []), r = resolveTargets(m);
  const plan = mermaidPlan(parsed, r.targets, rows);
  assert.deepEqual(plan.counts, { components: 1, endpoints: 3, calls: 2, notes: 3, reused: 0 }, JSON.stringify(plan.counts));
  assert.deepEqual(plan.creates, ['policy-engine']); assert.deepEqual(plan.flow?.name, 'Tunnel');
  const anchors = plan.ops.map((o) => o.anchor);
  assert.ok(anchors.includes('svc:policy-engine') && anchors.some((a) => a.startsWith('ing:policy-engine/')) && anchors.some((a) => a.startsWith('flow:pop-edge/')));
  const fn = plan.ops.filter((o) => o.anchor.startsWith('fn:pop-edge/')).pop()!.data as any;
  assert.deepEqual(fn.steps.map((s: any) => s.note), ['decides', '[alt: allowed]']);
  // a second import over the first one's rows: nothing new
  const map = new Map(rows.map((x) => [rowId(x), x]));
  for (const o of plan.ops) applyOp(map, { ...o, ...opRow(o) } as any);
  const again = mermaidPlan(parsed, r.targets, [...map.values()]);
  assert.deepEqual(again.ops, []); assert.deepEqual(again.counts, { components: 0, endpoints: 0, calls: 0, notes: 0, reused: 2 });
});

test('export: a plain trace gives participants, calls with returns, notes; ; and # are entities', () => {
  const t: any = {
    start: { service: 'a', ingress: 'in.x', fn: 'h', name: 'Do it; now' },
    participants: [{ id: 'client', label: 'client', kind: 'client' }, { id: 'svc:a', label: 'a', kind: 'service', service: 'a' }, { id: 'svc:b-c', label: 'b-c', kind: 'service', service: 'b-c' }, { id: 'ch:sqs:q', label: 'q', kind: 'channel' }],
    messages: [
      { from: 'client', to: 'svc:a', label: 'http:GET public/x', mode: 'sync', kind: 'entry', depth: 0, transport: 'http' },
      { from: 'svc:a', to: 'svc:b-c', label: 'http:POST b-c/y', mode: 'sync', kind: 'egress', depth: 1, transport: 'http', note: 'why #1' },
      { from: 'svc:a', to: 'svc:a', label: 'inner', mode: 'sync', kind: 'call', depth: 2, internal: true },
      { from: 'svc:a', to: 'ch:sqs:q', label: 'publish', mode: 'async', kind: 'egress', depth: 1, transport: 'sqs' },
    ],
  };
  assert.equal(exportMermaid(t, { description: 'line one\nline two' }), [
    '%% Flow: Do it#59; now (a · in.x)', '%% Description: line one', '%% line two', 'sequenceDiagram', 'title Do it#59; now',
    'actor client as client', 'participant a as a', 'participant b_c as b-c', 'participant sqs_q as sqs:q',
    'client->>a: GET /x', 'a->>b_c: POST /y', 'Note over a,b_c: why #35;1', 'b_c-->>a: return', 'a-)sqs_q: publish', 'a-->>client: return', '',
  ].join('\n'));
});
