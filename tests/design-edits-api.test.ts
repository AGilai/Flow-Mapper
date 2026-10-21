// Edit forms through REST and MCP: a hand-drawn flow made only through `edits` traces end to end, applies to the same traceHash as the
// draft read, errors carry their code and field, GET call tells which side of a call is a reference.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';
import { HASH_TRACE, traceHash } from '../core/description.ts';
import { trace } from '../core/trace.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());

const edit = (env: string, slug: string, e: object) => app.call('POST', `/api/envs/${env}/drafts/${slug}/edits`, { edit: e, author: 'ana' });
const ok = async (env: string, slug: string, e: object) => { const r = await edit(env, slug, e); assert.equal(r.status, 201, JSON.stringify(r.body)); return r.body; };

test('a hand-drawn flow made only through edits: it traces end to end in the draft, and apply gives the same trace', async () => {
  const groups = ['agent', 'edge', 'core'].map((key) => ({ key, label: key }));
  assert.equal((await app.call('POST', '/api/envs', { name: 'drawn', source: 'prod', mode: 'blank', groups })).status, 201);
  const slug = (await app.call('POST', '/api/envs/drawn/drafts', { name: 'draw' })).body.slug;
  await ok('drawn', slug, { kind: 'component', name: 'agent', serviceKind: 'client-app', groupPath: 'agent' });
  await ok('drawn', slug, { kind: 'component', name: 'edge', serviceKind: 'service', groupPath: 'edge' });
  await ok('drawn', slug, { kind: 'component', name: 'core', serviceKind: 'service', groupPath: 'core' });
  const ep = await ok('drawn', slug, { kind: 'endpoint', service: 'agent', id: 'in.open', transport: 'other', bindKey: 'client:agent/open', entryPoint: true });
  assert.deepEqual(ep.ops.map((o: any) => o.anchor), ['fn:agent/in.open.handle', 'ing:agent/in.open']);
  assert.deepEqual(ep.warnings, []);
  const c1 = await ok('drawn', slug, { kind: 'call', from: { service: 'agent', fn: 'in.open.handle' }, to: { endpoint: { service: 'edge', transport: 'http', bindKey: 'http:GET edge/hello' } }, operation: 'hello' });
  assert.deepEqual(c1.ops.map((o: any) => o.anchor), ['fn:edge/in.hello.handle', 'ing:edge/in.hello', 'egr:agent/out.edge.hello', 'fn:agent/in.open.handle']);
  assert.equal(c1.counts.added > 0, true);
  await ok('drawn', slug, { kind: 'call', from: { service: 'edge', fn: 'in.hello.handle' }, to: { endpoint: { service: 'core', transport: 'undecided', bindKey: '' } } });
  await ok('drawn', slug, { kind: 'call', from: { service: 'edge', fn: 'in.hello.handle' }, to: { bindKey: 'http:GET nowhere/x', transport: 'http' } });

  const q = `service=agent&ingress=in.open&draft=${slug}`;
  const t = (await app.call('GET', `/api/envs/drawn/trace?${q}`)).body;
  assert.deepEqual(t.messages.map((m: any) => `${m.kind}:${m.from}>${m.to}`), [
    'entry:client>svc:agent', 'egress:svc:agent>svc:edge', 'egress:svc:edge>svc:core', 'egress:svc:edge>missing:http:GET nowhere/x']);
  assert.equal(t.messages[1].target.fn, 'in.hello.handle'); assert.equal(t.messages[2].target.service, 'core');
  assert.equal(t.messages[2].transport, 'undecided'); assert.equal(t.messages[3].broken, true);
  assert.equal(t.participants.find((p: any) => p.service === 'agent').serviceKind, 'client-app');
  assert.equal(t.partial, undefined, 'no reference in a hand-drawn flow');
  const eps = (await app.call('GET', `/api/envs/drawn/entry-points?draft=${slug}`)).body;
  assert.deepEqual(eps.map((e: any) => `${e.service}/${e.id}`), ['agent/in.open']);
  assert.equal((await app.call('GET', '/api/envs/drawn/entry-points')).body.length, 0, 'the environment itself has nothing yet');

  const drafted = traceHash(trace(app.ctx.view('drawn', slug).g, { service: 'agent', ingress: 'in.open' }, HASH_TRACE)!);
  const applied = await app.call('POST', `/api/envs/drawn/drafts/${slug}/apply`, { by: 'ana' });
  assert.equal(applied.status, 200, JSON.stringify(applied.body));
  assert.equal(traceHash(trace(app.ctx.graph('drawn'), { service: 'agent', ingress: 'in.open' }, HASH_TRACE)!), drafted, 'the applied environment traces like the draft did');
  const findings = JSON.stringify(applied.body.results.map((r: any) => r.contract));
  assert.ok(!/dangling-egress[^}]*tbd:core/.test(findings), 'the undecided pair links: no dangling-egress for it');
  assert.ok(findings.includes('nowhere'), 'the call that is not designed yet is reported as a dangling egress');
});

test('errors: EditError codes with their field, NO_TARGET / NO_GROUP / BAD_KIND for ops and edits, a sealed environment refuses', async () => {
  const slug = (await app.call('POST', '/api/envs/hld/drafts', { name: 'err' })).body.slug;
  const bad = async (e: object) => { const r = await edit('hld', slug, e); return [r.status, r.body.error.code, r.body.error.details?.field]; };
  assert.deepEqual(await bad({ kind: 'component', name: 'Bad Name', serviceKind: 'service' }), [422, 'BAD_NAME', 'name']);
  assert.deepEqual(await bad({ kind: 'component', name: 'ok', serviceKind: 'robot' }), [422, 'BAD_KIND', 'serviceKind']);
  assert.deepEqual(await bad({ kind: 'component', name: 'ok', serviceKind: 'service', groupPath: 'nope' }), [422, 'NO_GROUP', undefined]);
  assert.deepEqual(await bad({ kind: 'endpoint', service: 'ghost', transport: 'http', bindKey: 'x' }), [422, 'NO_SERVICE', 'service']);
  assert.deepEqual(await bad({ kind: 'call', from: { service: 'users-svc', fn: 'f' }, to: { service: 'auth-svc', ingress: 'nope' } }), [422, 'NO_TARGET', 'to']);
  assert.deepEqual(await bad({ kind: 'flow', service: 'users-svc', ingress: 'in.getUser', order: { fn: 'get_user', seqs: [1] } }), [422, 'NO_ITEM', 'order']);
  assert.deepEqual(await bad({ kind: 'weird' }), [422, 'INVALID', 'kind']);
  assert.deepEqual(await bad({ kind: 'flow', service: 'users-svc', ingress: 'in.getUser' }), [422, 'NO_CHANGE', undefined]);
  const raw = async (anchor: string, data: object) => { const r = await app.call('POST', `/api/envs/hld/drafts/${slug}/ops`, { ops: [{ op: 'upsert', anchor, data }] }); return [r.status, r.body.error?.code]; };
  assert.deepEqual(await raw('fn:users-svc/f', { id: 'f', name: 'f', steps: [{ seq: 1, type: 'egress', target: 'out.nothing' }] }), [422, 'NO_TARGET']);
  assert.deepEqual(await raw('svc:x1', { kind: 'service', groupPath: 'nope' }), [422, 'NO_GROUP']);
  assert.deepEqual(await raw('svc:x1', { kind: 'robot' }), [422, 'BAD_KIND']);
  assert.deepEqual(await raw('svc:x1', { kind: 'service', groupPath: 'platform' }), [201, undefined]);
  assert.equal((await app.call('POST', '/api/envs/prod/drafts/x/edits', { edit: { kind: 'delete', anchor: 'svc:a' } })).body.error.code, 'ENV_SEALED');
  assert.equal((await app.call('POST', `/api/envs/hld/drafts/${slug}/edits`, {})).status, 422);
});

test('GET call: a call into a copied endpoint says it is a reference and from where; into a designed one it does not', async () => {
  const slug = (await app.call('POST', '/api/envs/hld/drafts', { name: 'calls' })).body.slug;
  await ok('hld', slug, { kind: 'call', from: { service: 'users-svc', fn: 'get_user' }, to: { service: 'auth-svc', ingress: 'in.verify' }, operation: 'verify' });
  const own = await ok('hld', slug, { kind: 'call', from: { service: 'users-svc', fn: 'get_user' }, to: { endpoint: { service: 'auth-svc', transport: 'http', bindKey: 'http:POST auth-svc/mine' } } });
  assert.deepEqual(own.ops.map((o: any) => o.anchor).slice(0, 2), ['fn:auth-svc/in.mine.handle', 'ing:auth-svc/in.mine']);
  const view = async (egress: string) => (await app.call('GET', `/api/envs/hld/call?service=users-svc&egress=${egress}&draft=${slug}`)).body;
  const ref = await view('out.auth-svc.verify');
  assert.deepEqual(ref.steps, [{ fn: 'get_user', seq: 1, operation: 'verify' }]);
  assert.deepEqual(ref.targets[0].reference, { service: 'auth-svc', ingress: 'in.verify', bindKey: 'http:POST auth-svc/verify', source: 'prod' });
  const mine = await view('out.auth-svc.in.mine');
  assert.equal(mine.targets[0].ingress, 'in.mine'); assert.equal('reference' in mine.targets[0], false);
  assert.equal((await app.call('GET', `/api/envs/hld/call?service=users-svc&egress=out.none&draft=${slug}`)).status, 404);
  assert.equal((await app.call('GET', '/api/envs/hld/call?service=users-svc')).status, 400);
  const mcp = await app.mcp('get_call', { env: 'hld', service: 'users-svc', egress: 'out.auth-svc.verify', draft: slug });
  assert.deepEqual(mcp.json, ref);
});

test('MCP edit_design: the same ops, recorded as an AI edit; set a flow name in the draft', async () => {
  const slug = (await app.call('POST', '/api/envs/hld/drafts', { name: 'mcp' })).body.slug;
  const r = await app.mcp('edit_design', { env: 'hld', draft: slug, edit: { kind: 'component', name: 'pop-swg', serviceKind: 'service', groupPath: 'platform' } });
  assert.equal(r.isError, false, r.text);
  assert.deepEqual(r.json.ops, [{ op: 'upsert', anchor: 'svc:pop-swg', data: { kind: 'service', groupPath: 'platform' } }]);
  const stored = (await app.call('GET', `/api/envs/hld/drafts/${slug}`)).body.ops[0];
  assert.deepEqual([stored.byAi, stored.author], [true, 'assistant']);
  assert.match((await app.mcp('edit_design', { env: 'hld', draft: slug, edit: { kind: 'component', name: 'X', serviceKind: 'service' } })).text, /BAD_NAME/);
});
