// 0.38.1 (#82, comment 225): the step markers `can fail` (details.can_fail) and `only when` (details.only_when). The trace passes them through as
// `canFail` / `onlyWhen`, a DB group aggregates its members', the Mermaid export writes them as notes, and the words and runs are pure.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { viewOf } from '../core/trace-view.ts';
import { canFailLine } from '../core/step-markers.ts';
import { sampleManifests, sampleModel, startApp } from './helpers.ts';

register('./web-loader.mjs', import.meta.url);
// @ts-ignore plain JS module shared with the browser
const { markerRuns, failNeed } = await import('../web/js/views/flow-markers-draw.js');
// @ts-ignore
const { canFailTag, canFailTip, onlyWhenTag, onlyWhenTip, guardRuns } = await import('../web/js/views/flow-markers-pure.js');

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201); });
after(async () => { await app.close(); });

const full = () => trace(buildIndex(sampleModel()), { service: 'member-api', ingress: 'in.updateProfile' }, { scope: 'full', maxMessages: 500 })!;
const FAIL = [{ when: 'no member has this id', error: '404 member not found', source: { file: 'routes/profile.js', line: 24 } }, { when: 'the database call times out', error: '503 database unavailable', source: { file: 'routes/profile.js', line: 24 } }];

test('trace: can_fail and only_when are read from details and sit on the message', () => {
  const ms = full().messages;
  const find = ms.find((m) => m.label === 'find by id')!, upd = ms.find((m) => m.label === 'update')!;
  assert.deepEqual(find.canFail, FAIL);
  assert.equal(find.onlyWhen, undefined);
  assert.deepEqual(upd.onlyWhen, { guard: 'the email changed', source: { file: 'lib/profile.js', line: 12 } });
  assert.equal(upd.canFail!.length, 1);
  assert.ok(ms.filter((m) => m.onlyWhen).length >= 3, 'every step of the remaining arm carries the guard');
  assert.equal(ms.find((m) => m.label === 'http:POST member-notifier/audit-read')!.canFail, undefined, 'a plain step has neither');
});

test('trace: malformed markers are dropped', () => {
  const model = sampleModel();
  const st = model.services.find((s: any) => s.name === 'member-api')?.functions?.find((f: any) => f.id === 'updateProfile')?.steps?.[0] as any;
  if (st) { st.details = { can_fail: [{ when: 'x' }, 'no', { error: 'ok' }], only_when: { source: {} } }; }
  const m = trace(buildIndex(model), { service: 'member-api', ingress: 'in.updateProfile' }, { scope: 'full', maxMessages: 500 })!.messages.find((x) => x.label === 'find by id')!;
  if (st) { assert.deepEqual(m.canFail, [{ error: 'ok' }]); assert.equal(m.onlyWhen, undefined); }
});

test('REST and MCP trace_flow return canFail and onlyWhen', async () => {
  const q = '/api/envs/prod/trace?service=member-api&ingress=in.updateProfile&detail=full';
  const r = (await app.call('GET', q)).body.messages;
  assert.equal(r.find((m: any) => m.label === 'find by id').canFail.length, 2);
  assert.equal(r.find((m: any) => m.label === 'update').onlyWhen.guard, 'the email changed');
  const mcp = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'trace_flow', arguments: { env: 'prod', service: 'member-api', ingress: 'in.updateProfile', detail: 'full' } } });
  const ms = JSON.parse(mcp.body.result.content[0].text).messages;
  assert.equal(ms.find((m: any) => m.label === 'find by id').canFail[1].error, '503 database unavailable');
  assert.equal(ms.find((m: any) => m.label === 'update').onlyWhen.guard, 'the email changed');
});

test('external view: the DB group aggregates its members', () => {
  const v = viewOf(full(), { detail: 'external' });
  const g = v.messages.find((m) => m.dbGroup && m.label.includes('members'))!;
  assert.ok(g, 'update + insert fold into one row');
  assert.equal(g.dbGroup!.count, 2);
  assert.deepEqual(g.canFail!.map((c) => c.error), ['409 email already taken']);
  assert.equal(g.onlyWhen!.guard, 'the email changed');
  assert.equal(v.messages.find((m) => m.label === 'find by id')!.canFail!.length, 2, 'the first find is its own row (an egress in between)');
  const egress = v.messages.find((m) => m.kind === 'egress' && m.onlyWhen);
  assert.ok(egress, 'the egress of the arm carries it too');
});

test('external view: members with different guards list each guard once', () => {
  const t = full();
  const ms = t.messages.filter((m) => m.label === 'update' || m.label === 'insert');
  ms[1] = ms[1];
  ms[1].onlyWhen = { guard: 'the email is new' };
  const g = viewOf(t, { detail: 'external' }).messages.find((m) => m.dbGroup)!;
  assert.equal(g.onlyWhen!.guard, 'the email changed; the email is new');
});

test('Mermaid export: each marker is a Note over line', async () => {
  const res = await app.call('GET', '/api/envs/prod/flows/mermaid?service=member-api&ingress=in.updateProfile&detail=full');
  const text: string = typeof res.body === 'string' ? res.body : res.body.mermaid ?? res.body.text ?? '';
  const notes = text.split('\n').filter((l) => l.includes('Note over'));
  assert.ok(notes.some((l) => /can fail: 404 member not found \(when no member has this id\)#59; 503 database unavailable/.test(l)), text);
  assert.ok(notes.some((l) => l.includes('can fail: 409 email already taken')));
  assert.equal(notes.filter((l) => l.includes('only when the email changed')).length, 3, 'the two DB ops and the egress (the internal call is not an arrow in Mermaid)');
});

test('words: the tag, the tooltip and the one-line form', () => {
  assert.equal(canFailTag([FAIL[0]]), 'can fail: 404 member not found');
  assert.equal(canFailTag(FAIL), 'can fail (2)');
  assert.equal(canFailTip([FAIL[0]]), 'When: no member has this id\nError: 404 member not found\nroutes/profile.js:24');
  assert.match(canFailTip(FAIL), /^1\. When: no member has this id\n {3}Error: 404 member not found\n {3}routes\/profile\.js:24\n2\. When: the database call times out/);
  assert.equal(canFailTip([{ error: 'boom' }]), 'Error: boom');
  assert.equal(canFailLine(FAIL), 'can fail: 404 member not found (when no member has this id); 503 database unavailable (when the database call times out)');
  assert.equal(onlyWhenTag({ guard: 'the email changed' }), 'only when the email changed');
  assert.equal(onlyWhenTag({ guard: 'the email changed' }, 14), 'only when the…');
  assert.equal(onlyWhenTip({ guard: 'g', source: { file: 'a.js', line: 3 } }), 'Only when: g\na.js:3');
});

test('runs: consecutive steps with one guard are one run; a step without it, or another guard, ends it', () => {
  const r = guardRuns(['a', 'a', 'a', null, 'a', 'b', 'b'] as any);
  assert.deepEqual(r.map((x: any) => x && [x.first, x.last]), [[true, false], [false, false], [false, true], null, [true, true], [true, false], [false, true]]);
  assert.deepEqual([r[0]!.start, r[0]!.end, r[4]!.start, r[4]!.end, r[6]!.start], [0, 2, 4, 4, 5]);
  assert.deepEqual(guardRuns([]), []);
});

test('runs on a lane: one marker on the first step, one gutter line per run; returns do not break a run', () => {
  const mk = (g?: string, type = 'call') => ({ type, msg: { onlyWhen: g ? { guard: g } : undefined } });
  const { byMsg, lines } = markerRuns([mk('g'), mk(undefined, 'return'), mk('g'), mk('h'), mk()]);
  assert.equal(lines.length, 2);
  assert.deepEqual([lines[0].row0, lines[0].row1, lines[0].guard], [0, 2, 'g']);
  assert.deepEqual([...byMsg.values()].map((x: any) => x.first), [true, false, true]);
  assert.ok(failNeed({ canFail: FAIL }) > 0 && failNeed({}) === 0);
});
