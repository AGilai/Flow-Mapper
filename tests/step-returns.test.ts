// What a call returns (0.33.2, #81): the step field `returns: {label, detail?}` through the manifest schema, draft ops, edit_design, the trace,
// the Mermaid import (`B-->>A: text`) and export, plus the #71 gaps closed with it (a `new` mark as a green rect, a return in a step-less branch warned about).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { returnsProblem, cleanReturns } from '../core/step-returns.ts';
import { parseMermaid, rectMark } from '../core/mermaid-parse.ts';
import { readSample, startDesign } from './helpers.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());

const D = (slug: string) => `/api/envs/hld/drafts/${slug}`;
const open = async (name: string) => (await app.call('POST', '/api/envs/hld/drafts', { name })).body.slug as string;
const trace = async (slug: string, f: { service: string; ingress: string }) => (await app.call('GET', `/api/envs/hld/trace?detail=full&service=${f.service}&ingress=${f.ingress}&draft=${slug}`)).body;
const exp = async (slug: string, f: { service: string; ingress: string }) => (await app.call('GET', `/api/envs/hld/flows/mermaid?service=${f.service}&ingress=${f.ingress}&draft=${slug}`)).body as string;

test('returnsProblem: label 1 to 80 characters on one line, detail up to 500, nothing else', () => {
  assert.equal(returnsProblem(undefined), null); assert.equal(returnsProblem(null), null);
  assert.equal(returnsProblem({ label: 'x'.repeat(80), detail: 'y'.repeat(500) }), null);
  assert.equal(returnsProblem({ label: 'ok', detail: 'two\nlines are fine in a detail' }), null);
  for (const bad of [{ label: '' }, { label: '   ' }, { label: 'x'.repeat(81) }, { label: 'a\nb' }, { label: 'ok', detail: 'y'.repeat(501) }, { label: 'ok', detail: 5 }, { detail: 'no label' }, { label: 'ok', extra: 1 }, 'ok', ['ok']]) {
    assert.ok(returnsProblem(bad), JSON.stringify(bad));
  }
  assert.deepEqual(cleanReturns({ label: ' 200 ', detail: '  ' }), { label: '200' });
});

test('manifest: the sample step carries returns into the trace; a bad label is a 422', async () => {
  const t = (await app.call('GET', '/api/envs/prod/trace?detail=full&service=api-gateway&ingress=in.getOrder')).body;
  const m = t.messages.find((x: any) => x.returns);
  assert.equal(m.returns.label, '200 order JSON'); assert.match(m.returns.detail, /404 when the id is unknown/);
  const mf = readSample('api-gateway.json'); mf.version += 1;
  mf.functions.find((f: any) => f.id === 'routeGetOrder').steps[0].returns = { label: 'x'.repeat(81) };
  assert.equal((await app.call('POST', '/api/ingest?dryRun=1', mf)).status, 422);
  mf.functions.find((f: any) => f.id === 'routeGetOrder').steps[0].returns = { label: 'ok', detail: 'd'.repeat(501) };
  assert.equal((await app.call('POST', '/api/ingest?dryRun=1', mf)).status, 422);
  for (const label of ['a\u0007b', 'tab\there', 'two\nlines', '   ']) {   // QA #71/#81: the schema pattern let a control character count as the non-blank one
    mf.functions.find((f: any) => f.id === 'routeGetOrder').steps[0].returns = { label };
    assert.equal((await app.call('POST', '/api/ingest?dryRun=1', mf)).status, 422, JSON.stringify(label));
  }
  mf.functions.find((f: any) => f.id === 'routeGetOrder').steps[0].returns = { label: 'fine', detail: 'short' };
  assert.equal((await app.call('POST', '/api/ingest?dryRun=1', mf)).status, 200);
});

test('draft ops (plans, edit_in_draft): a function step with returns is checked like a manifest', async () => {
  const d = await open('ret-ops');
  const fn = (returns: unknown) => ({ ops: [{ op: 'upsert', anchor: 'fn:users-svc/retFn', data: { id: 'retFn', name: 'retFn', steps: [{ seq: 1, type: 'call', kind: 'leaf', note: 'x', returns }] } }] });
  assert.equal((await app.call('POST', `${D(d)}/ops`, fn({ label: '' }))).status, 422);
  assert.equal((await app.call('POST', `${D(d)}/ops`, fn({ label: 'ok', detail: 'z'.repeat(501) }))).status, 422);
  assert.equal((await app.call('POST', `${D(d)}/ops`, fn({ label: '204 done', detail: 'nothing in the body' }))).status, 201);
});

const TEXT = `%% flow: Returns demo
sequenceDiagram
  participant U as users-svc
  participant A as auth-svc
  participant P as policy-engine
  U->>A: POST /returns/verify
  A-->>U: 204 verified
  rect rgb(214, 245, 214)
  U->>P: GET /returns/policy
  end
  P-->>U: return
  rect rgb(255, 244, 214)
  U->>A: POST /returns/audit
  end
  A-->>U: audited`;

test('mermaid: B-->>A: text is the label of the call it answers; export writes it back (return when none); edit_design sets, clears and checks it', async () => {
  const d = await open('ret-mm');
  const r = await app.call('POST', `${D(d)}/mermaid`, { text: TEXT, groupPath: 'platform' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const flow = r.body.flow, t = await trace(d, flow);
  const call = (path: string) => t.messages.find((m: any) => m.kind === 'egress' && m.label.includes(path));
  assert.equal(call('verify').returns?.label, '204 verified');
  assert.equal(call('policy').returns, undefined, 'a return labelled "return" says nothing');
  assert.equal(call('audit').returns?.label, 'audited');
  // #71 (b): a green rect is a `new` mark, any other colour changed
  assert.equal(call('policy').mark, 'new'); assert.equal(call('audit').mark, 'changed');
  const text = await exp(d, flow);
  assert.match(text, /-->>[A-Za-z0-9_]+: 204 verified/); assert.match(text, /-->>[A-Za-z0-9_]+: return/); assert.match(text, /-->>[A-Za-z0-9_]+: audited/);
  assert.match(text, /rect rgb\(214, 245, 214\)/); assert.match(text, /rect rgb\(255, 244, 214\)/);
  // import -> export -> import -> export is stable, marks included
  const d2 = await open('ret-mm2');
  const r2 = await app.call('POST', `${D(d2)}/mermaid`, { text, groupPath: 'platform' });
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  const t2 = await trace(d2, r2.body.flow), shape = (ms: any[]) => ms.filter((m) => m.kind === 'egress').map((m) => [m.label, m.mark ?? '', m.returns?.label ?? '']);
  assert.deepEqual(shape(t2.messages), shape(t.messages));
  assert.deepEqual((await exp(d2, r2.body.flow)).split('\n').filter((l) => /-->>|rect|end/.test(l)).map((l) => l.trim()), text.split('\n').filter((l) => /-->>|rect|end/.test(l)).map((l) => l.trim()));

  // edit_design: the call form's returns
  const m = call('verify'), edit = (e: object) => app.call('POST', `${D(d)}/edits`, { edit: { kind: 'call', from: { service: m.service, fn: m.fn }, edit: { egress: m.egress, seq: m.seq }, to: { service: 'auth-svc', ingress: m.target.ingress }, ...e }, author: 'ana' });
  assert.equal((await edit({ returns: { label: '200 token', detail: 'The signed token, valid for an hour.' } })).status, 201);
  const m2 = (await trace(d, flow)).messages.find((x: any) => x.label.includes('verify'));
  assert.deepEqual(m2.returns, { label: '200 token', detail: 'The signed token, valid for an hour.' });
  assert.match(await exp(d, flow), /-->>[A-Za-z0-9_]+: 200 token/);
  assert.equal((await edit({ returns: { label: 'x'.repeat(81) } })).status, 422);
  assert.equal((await edit({ returns: { label: 'ok', detail: 'y'.repeat(501) } })).status, 422);
  assert.equal((await edit({ operation: 'POST /returns/verify' })).status, 201);   // a later edit without `returns` keeps it
  assert.equal((await trace(d, flow)).messages.find((x: any) => x.label.includes('verify')).returns?.label, '200 token');
  assert.equal((await edit({ returns: null })).status, 201);
  assert.equal((await trace(d, flow)).messages.find((x: any) => x.label.includes('verify')).returns, undefined);
});

test('#71 gaps: rect colours, a return in a branch with no step is warned about, not lost silently', () => {
  assert.deepEqual(['rgb(214, 245, 214)', '#d6f5d6', '#0f0', 'lightgreen', 'rgba(0,200,0,.3)'].map(rectMark), Array(5).fill('new'));
  assert.deepEqual(['rgb(255, 244, 214)', '#ffeecc', 'yellow', 'rgb(200, 220, 255)', 'nonsense'].map(rectMark), Array(5).fill('changed'));
  const p = parseMermaid(`sequenceDiagram\n  alt ok\n  A->>B: GET /x\n  B-->>A: 200\n  else broken\n  B-->>A: 500 boom\n  end`);
  assert.equal(p.messages.find((m) => m.label === 'GET /x')?.response, '200');
  assert.equal(p.warnings.length, 1); assert.match(p.warnings[0].text, /'500 boom'.*no step to carry it/); assert.equal(p.warnings[0].line, 6);
});
