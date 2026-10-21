// Importing an HLD plan into a draft (docs/DESIGN-IMPORT.md): the demo plan samples/envs/sase-hld.plan.json becomes ops,
// every error code, the transitional `undecided` encoding, dry run, and the applied result traces end to end.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES, startApp } from './helpers.ts';

const plan = () => JSON.parse(readFileSync(join(SAMPLES, 'envs/sase-hld.plan.json'), 'utf8'));
const recipe = () => { const { drafts: _d, ...r } = JSON.parse(readFileSync(join(SAMPLES, 'envs/sase-hld.json'), 'utf8')); return r; };
const all = (d: string) => readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')));

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: [...all(SAMPLES), ...all(join(SAMPLES, 'deltas'))] })).status, 201);
  for (const f of all(join(SAMPLES, 'dtos'))) assert.equal((await app.call('POST', `/api/envs/${f.env}/dtos`, { dtos: f.dtos })).status, 201);
  assert.equal((await app.call('POST', '/api/envs', recipe())).status, 201);
});
after(() => app.close());

const E = '/api/envs/sase-hld', D = `${E}/drafts`;
let n = 0;
const fresh = async () => { const slug = `p${++n}`; await app.call('POST', D, { name: slug, slug }); return slug; };
const send = async (p: unknown, q = '') => { const slug = await fresh(); return { slug, ...(await app.call('POST', `${D}/${slug}/plan${q}`, p)) }; };
const version = async (s: string) => (await app.call('GET', `${E}/services/${s}`)).body.service.version;

test('the demo plan becomes ops and counts; the plan is kept on the draft without its manifests; the link becomes a link: op, blocking questions reported', async () => {
  const r = await send(plan());
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.ops, 17, '17 = the 14 plus pop-edge egress out.users.posture (0.25.0 posture demo) plus the links usage-metering and push-config-update (0.28: links are applied); the groupPath of auth-svc is what the copy has: no header op');
  assert.deepEqual(r.body.counts, { added: 6, removed: 0, changed: 1 }, 'sase-agent, pop-edge, one function and one endpoint on auth-svc, two links; one DTO changed');
  assert.deepEqual(r.body.skipped, { links: 0 }, '0.28: skipped.links counts only the links NOT applied');
  assert.deepEqual(r.body.links, { abstract: 2, flow: 0, skipped: 0 });
  assert.deepEqual(r.body.questions, { total: 3, blocking: ['Q3'] });
  const d = (await app.call('GET', `${D}/${r.slug}`)).body;
  assert.equal(d.plan.manifests, undefined); assert.equal(d.plan.links.length, 2); assert.equal(d.plan.questions.length, 3); assert.equal(d.plan.mapping.length, 1);
  assert.ok(d.ops.every((o: any) => o.author === 'anonymous' && o.byAi === false));
  const anchors = d.ops.map((o: any) => o.anchor);
  assert.ok(['svc:sase-agent', 'svc:pop-edge', 'ing:auth-svc/in.token.device', 'fn:auth-svc/TokenController.device', 'flow:sase-agent/in.tunnel.open', 'dto:pop-edge/request/-/in.tunnel.open'].every((a) => anchors.includes(a)), anchors.join(' '));
  assert.ok(!anchors.includes('svc:auth-svc'));
});

test('transitional undecided encoding (other + details.transport) is stored as transport undecided, with a warning', async () => {
  const r = await send(plan());
  assert.match(r.body.warnings.join(' '), /1 item\(s\) used the transitional encoding/);
  const op = (await app.call('GET', `${D}/${r.slug}`)).body.ops.find((o: any) => o.anchor === 'egr:pop-edge/out.policy.get');
  assert.equal(op.data.transport, 'undecided');
  assert.equal(op.data.details.transport, undefined);
  assert.deepEqual(op.data.details.candidates, ['grpc', 'amqp']);
});

test('errors: PLAN_VERSION, PLAN_ENV, PLAN_EXISTS, PLAN_NO_SERVICE, a file reference, a schema error with its path; nothing is appended', async () => {
  const code = async (p: unknown) => { const r = await send(p); const ops = (await app.call('GET', `${D}/${r.slug}`)).body.ops.length; return { status: r.status, code: r.body.error?.code, details: r.body.error?.details, ops, msg: r.body.error?.message }; };
  assert.deepEqual((({ status, code, ops }) => ({ status, code, ops }))(await code({ ...plan(), planVersion: 2 })), { status: 422, code: 'PLAN_VERSION', ops: 0 });
  assert.equal((await code({ ...plan(), environment: { name: 'other' } })).code, 'PLAN_ENV');
  const exists = { ...plan(), manifests: [{ ...plan().manifests[1], service: { name: 'auth-svc', kind: 'service' } }] };
  const e = await code(exists);
  assert.equal(e.code, 'PLAN_EXISTS'); assert.match(e.msg, /reclassify it as an extension/);
  assert.equal((await code({ ...plan(), extensions: [{ service: 'nobody', upsert: {} }] })).code, 'PLAN_NO_SERVICE');
  const ref = await code({ ...plan(), manifests: ['manifests/pop-edge.json'] });
  assert.equal(ref.code, 'INVALID'); assert.match(ref.msg, /inline the manifest/); assert.equal(ref.details[0].path, 'manifests[0]');
  const bad = plan(); bad.manifests[1].ingress[0].transport = 'carrier-pigeon';
  const s = await code(bad);
  assert.equal(s.code, 'INVALID'); assert.match(s.details[0].path, /^manifests\[1\]\.ingress\[0\]\.transport/);
  assert.equal((await code({ ...plan(), extensions: [{ service: 'auth-svc', delete: { ingress: ['in.verify'] } }] })).code, 'INVALID');
  assert.equal((await code({ ...plan(), manifests: [plan().manifests[1], plan().manifests[1]] })).code, 'PLAN_EXISTS', 'the same component twice');
  assert.equal(e.ops, 0);
  const noEnv = await app.call('POST', '/api/envs/prod/drafts/x/plan', plan());
  assert.equal(noEnv.body.error.code, 'ENV_SEALED');
});

test('an invalid item in the middle of an otherwise good plan appends nothing (validated as ops, all or nothing)', async () => {
  const p = plan(); p.extensions[0].upsert.ingress[0].handler = 7;
  const r = await send(p);
  assert.equal(r.status, 422);
  assert.equal((await app.call('GET', `${D}/${r.slug}`)).body.ops.length, 0);
});

test('dry run: ops are added, applied and rolled back; the contract comes back; nothing is written, not even the ops', async () => {
  const slug = await fresh(), v = await version('auth-svc');
  const r = await app.call('POST', `${D}/${slug}/plan?dryRun=1`, plan());
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.dryRun, true);
  const by = Object.fromEntries(r.body.results.map((x: any) => [x.service, x]));
  assert.deepEqual(Object.keys(by).sort(), ['auth-svc', 'pop-edge', 'sase-agent']);
  assert.equal(by['auth-svc'].toVersion, v + 1);
  assert.ok(by['pop-edge'].contract.findings.some((f: any) => f.code === 'dangling-egress' && /policy/.test(JSON.stringify(f))), 'the undecided call has no callee yet');
  assert.ok(!by['sase-agent'].contract.findings.some((f: any) => f.code === 'dangling-egress'), 'the agent reaches pop-edge');
  assert.equal((await app.call('GET', `${D}/${slug}`)).body.ops.length, 0);
  assert.equal((await app.call('GET', `${D}/${slug}`)).body.plan, null);
  assert.equal(await version('auth-svc'), v);
  assert.equal((await app.call('GET', `${E}/services/pop-edge`)).status, 404);
});

test('MCP apply_import_plan: same ops, recorded as an AI edit; dryRun rolls back', async () => {
  const slug = await fresh();
  const call = async (args: any) => { const x = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'apply_import_plan', arguments: args } }); return x.body.result; };
  const dry = await call({ env: 'sase-hld', draft: slug, plan: plan(), dryRun: true });
  assert.equal(dry.isError, false, dry.content[0].text);
  assert.equal(JSON.parse(dry.content[0].text).dryRun, true);
  assert.equal((await app.call('GET', `${D}/${slug}`)).body.ops.length, 0);
  const r = await call({ env: 'sase-hld', draft: slug, plan: plan() });
  assert.equal(r.isError, false, r.content[0].text);
  const ops = (await app.call('GET', `${D}/${slug}`)).body.ops;
  assert.equal(ops.length, 17); assert.ok(ops.every((o: any) => o.byAi && o.author === 'assistant'));
  const bad = await call({ env: 'sase-hld', draft: slug, plan: { ...plan(), planVersion: 9 } });
  assert.equal(bad.isError, true); assert.match(bad.content[0].text, /PLAN_VERSION/);
});

// last: it applies the plan, after which the components exist
test('apply: the flow of the client app traces into pop-edge and auth-svc; flow name and description are stored; DTOs and the changed field are in', async () => {
  const slug = await fresh();
  assert.equal((await app.call('POST', `${D}/${slug}/plan`, plan())).status, 201);
  const m = (await app.call('GET', `${E}/marks?draft=${slug}`)).body;
  assert.equal(m.marks['svc:sase-agent'].mark, 'new'); assert.equal(m.marks['svc:pop-edge'].mark, 'new');
  assert.equal(m.marks['ing:sase-agent/in.tunnel.open'], undefined, 'no mark under a new component');
  assert.equal(m.marks['svc:auth-svc'].what, '+1 endpoint · +1 function');
  assert.equal(m.marks['dto:users-svc/response/-/in.getUser#createdAt'].was, 'was string');
  assert.equal(m.marks['dto:users-svc/response/-/in.getUser#deviceCertFingerprint'].mark, 'new');
  const ap = await app.call('POST', `${D}/${slug}/apply`, { by: 'ana' });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.deepEqual(ap.body.results.map((x: any) => x.service).sort(), ['auth-svc', 'pop-edge', 'sase-agent']);
  const eps = (await app.call('GET', `${E}/entry-points`)).body;
  assert.ok(eps.some((e: any) => e.service === 'sase-agent' && e.id === 'in.tunnel.open' && e.bindKey === 'client:sase-agent/tunnel-open' && e.entryPoint));
  const t = (await app.call('GET', `${E}/trace?service=sase-agent&ingress=in.tunnel.open`)).body;
  const hops = new Set(t.messages.flatMap((x: any) => [x.from, x.to]));
  assert.ok(hops.has('svc:sase-agent') && hops.has('svc:pop-edge') && hops.has('svc:auth-svc'), [...hops].join(' '));
  const names = app.ctx.db.prepare("SELECT name, author FROM flow_names WHERE env = 'sase-hld'").all() as any[];
  assert.deepEqual(names.map((x) => ({ ...x })), [{ name: 'Agent connects to POP', author: 'ana' }]);
  const desc = (await app.call('GET', `${E}/descriptions?service=sase-agent&ingress=in.tunnel.open`)).body;
  assert.match(desc.flow.human.text, /^The agent opens a TLS tunnel.*\n1\. Agent opens the tunnel/s);
  assert.deepEqual((await app.call('GET', `${E}/dtos?service=pop-edge`)).body.map((d: any) => d.role), ['request']);
  assert.equal((await app.call('GET', `${E}/dtos?service=users-svc&ingress=in.getUser`)).body[0].content.deviceCertFingerprint, 'ab:cd:ef');
  const pe = (await app.call('GET', `${E}/services/pop-edge/egress/out.policy.get`)).body;
  assert.equal(pe.transport, 'undecided');
  assert.equal((await app.call('GET', `${E}/marks`)).body.marks['svc:pop-edge'].mark, 'new', 'once applied, the comparison with the baseline still says new');
  assert.equal((await app.call('GET', `${E}/marks`)).body.marks['svc:sase-agent'].mark, 'new');
});
