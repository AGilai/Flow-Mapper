// Flow relations (0.28.2, #50) over HTTP and MCP on the demo design sase-hld and its draft hld-import: the plan's relation, reads with ?draft=, edits
// (add, change, delete, dependents), marks, apply, plan/links backfill, Full copy, delete, MCP parity. The mutating tests come last.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES, startApp } from './helpers.ts';
import { seedEnvRecipes } from '../scripts/seed-envs.ts';

const all = (d: string) => readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')));
const plan = () => JSON.parse(readFileSync(join(SAMPLES, 'envs/sase-hld.plan.json'), 'utf8'));
let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: [...all(SAMPLES), ...all(join(SAMPLES, 'deltas'))] })).status, 201);
  for (const f of all(join(SAMPLES, 'dtos'))) assert.equal((await app.call('POST', `/api/envs/${f.env}/dtos`, { dtos: f.dtos })).status, 201);
  seedEnvRecipes(app.ctx, join(SAMPLES, 'envs'));
});
after(() => app.close());

const E = '/api/envs/sase-hld', D = `${E}/drafts`;
const get = async (p: string) => { const r = await app.call('GET', p); assert.equal(r.status, 200, `${p}: ${JSON.stringify(r.body)}`); return r.body; };
const mcp = async (name: string, args: any) => {
  const r = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } });
  return { isError: r.body.result.isError as boolean, json: r.body.result.isError ? null : JSON.parse(r.body.result.content[0].text) };
};
let n = 0;
const fresh = async (withPlan = true) => { const slug = `s${++n}`; assert.equal((await app.call('POST', D, { name: slug, slug })).status, 201); if (withPlan) assert.equal((await app.call('POST', `${D}/${slug}/plan`, plan())).status, 201); return slug; };
const edit = (slug: string, e: unknown) => app.call('POST', `${D}/${slug}/edits`, { edit: e });
const TUN = { service: 'sase-agent', ingress: 'in.tunnel.open' }, TOK = { service: 'auth-svc', ingress: 'in.token.device' }, VER = { service: 'auth-svc', ingress: 'in.verify' };

test('the demo plan brings one relation: in the draft, not in the design; both ends see it, with the phrase for their end', async () => {
  assert.deepEqual(await get(`${E}/flow-relations`), []);
  const rows = await get(`${E}/flow-relations?draft=hld-import`);
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].type, rows[0].from, rows[0].to, rows[0].phrase, rows[0].direction], ['same-topic', { service: 'auth-svc', ingress: 'in.token.device' }, { service: 'sase-agent', ingress: 'in.tunnel.open' }, 'same topic as', 'out']);
  assert.match(rows[0].note, /read the two together/);
  for (const f of [TUN, TOK]) assert.equal((await get(`${E}/flow-relations?draft=hld-import&service=${f.service}&ingress=${f.ingress}`)).length, 1);
  assert.deepEqual(await get(`${E}/flow-relations?draft=hld-import&service=auth-svc&ingress=in.verify`), []);
  assert.deepEqual(await get(`${E}/flow-relations?draft=hld-import&type=supersedes`), []);
});

test('reads: sealed env [], bad type or half a flow 422, unknown draft 404; marks count the relation as new', async () => {
  assert.deepEqual(await get('/api/envs/prod/flow-relations'), []);
  assert.equal((await app.call('GET', `${E}/flow-relations?type=rhymes`)).status, 422);
  assert.equal((await app.call('GET', `${E}/flow-relations?service=auth-svc`)).status, 422);
  assert.equal((await app.call('GET', `${E}/flow-relations?draft=nope`)).status, 404);
  const m = await get(`${E}/marks?draft=hld-import`);
  assert.deepEqual(m.counts.relations, { new: 1, changed: 0, removed: 0 });
  const rel = Object.entries(m.marks).filter(([k]) => k.startsWith('rel:'));
  assert.equal(rel.length, 1); assert.equal((rel[0][1] as any).mark, 'new');
});

test('edit flow-relation: add (variant-of is directional), the same pair and type again changes only the note, a symmetric pair is stored once from either side', async () => {
  const s = await fresh();
  const a = await edit(s, { kind: 'flow-relation', from: TUN, to: VER, type: 'variant-of', note: 'second take' });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const [r1] = await get(`${E}/flow-relations?draft=${s}&service=sase-agent&ingress=in.tunnel.open`);
  assert.deepEqual([r1.type, r1.direction, r1.phrase, r1.other], ['variant-of', 'out', 'is a variant of', VER]);
  const [r2] = await get(`${E}/flow-relations?draft=${s}&service=auth-svc&ingress=in.verify`);
  assert.deepEqual([r2.direction, r2.phrase, r2.other], ['in', 'has a variant', TUN]);
  await edit(s, { kind: 'flow-relation', from: TUN, to: VER, type: 'variant-of', note: 'edited' });
  assert.equal((await get(`${E}/flow-relations?draft=${s}&type=variant-of`)).length, 1);
  await edit(s, { kind: 'flow-relation', from: TUN, to: VER, type: 'contradicts' });
  await edit(s, { kind: 'flow-relation', from: VER, to: TUN, type: 'contradicts', note: 'again' });
  const c = await get(`${E}/flow-relations?draft=${s}&type=contradicts`);
  assert.equal(c.length, 1); assert.equal(c[0].note, 'again');
  const sup = await edit(s, { kind: 'flow-relation', from: VER, to: TUN, type: 'supersedes' });
  assert.equal(sup.status, 201);
  const [x] = await get(`${E}/flow-relations?draft=${s}&service=auth-svc&ingress=in.verify&type=supersedes`);
  assert.deepEqual([x.phrase, x.direction], ['supersedes', 'out']);
  assert.equal((await get(`${E}/flow-relations?draft=${s}&service=sase-agent&ingress=in.tunnel.open&type=supersedes`))[0].phrase, 'is superseded by');
});

test('edit flow-relation: changing the type (id) moves the relation; the errors BAD_TYPE, NO_FLOW, SAME_FLOW name the field; delete rel:<id> removes it', async () => {
  const s = await fresh();
  await edit(s, { kind: 'flow-relation', from: TUN, to: VER, type: 'same-topic' });
  const [r] = await get(`${E}/flow-relations?draft=${s}`);
  const mv = await edit(s, { kind: 'flow-relation', id: r.id, from: TUN, to: VER, type: 'supersedes' });
  assert.equal(mv.status, 201);
  const after = await get(`${E}/flow-relations?draft=${s}`);
  assert.deepEqual(after.map((x: any) => x.type).sort(), ['same-topic', 'supersedes'], 'the plan relation stays; ours moved');
  assert.ok(!after.some((x: any) => x.id === r.id));
  const bad = [[{ type: 'rhymes' }, 'BAD_TYPE', 'type'], [{ to: { service: 'auth-svc', ingress: 'in.nope' } }, 'NO_FLOW', 'to'], [{ to: TUN }, 'SAME_FLOW', 'to'], [{ to: { service: 'ghost', ingress: 'x' } }, 'NO_FLOW', 'to']] as const;
  for (const [over, code, field] of bad) {
    const e = await edit(s, { kind: 'flow-relation', from: TUN, to: VER, type: 'supersedes', ...over });
    assert.equal(e.status, 422); assert.equal(e.body.error.code, code); assert.equal(e.body.error.details?.field ?? e.body.error.field, field);
  }
  const mine = after.find((x: any) => x.type === 'supersedes');
  assert.equal((await edit(s, { kind: 'delete', anchor: `rel:${mine.id}` })).status, 201);
  assert.ok(!(await get(`${E}/flow-relations?draft=${s}`)).some((x: any) => x.type === 'supersedes'));
  assert.equal((await edit(s, { kind: 'delete', anchor: 'rel:nope' })).status, 422);
});

test('deleting an endpoint or a component deletes the relations that name it, in the same request; undo brings them back', async () => {
  const s = await fresh();
  await edit(s, { kind: 'flow-relation', from: TUN, to: VER, type: 'contradicts' });
  assert.equal((await get(`${E}/flow-relations?draft=${s}`)).length, 2);
  const d = await edit(s, { kind: 'delete', anchor: 'ing:auth-svc/in.verify' });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  assert.deepEqual((await get(`${E}/flow-relations?draft=${s}`)).map((x: any) => x.type), ['same-topic'], 'only the one that names in.verify went');
  const d2 = await edit(s, { kind: 'delete', anchor: 'svc:sase-agent' });
  assert.equal(d2.status, 201, JSON.stringify(d2.body));
  assert.deepEqual(await get(`${E}/flow-relations?draft=${s}`), []);
});

test('plan/links backfills the relation for a draft imported before 0.28.2; the counts say flow: 1', async () => {
  const s = await fresh();
  const [planned] = await get(`${E}/flow-relations?draft=${s}`);
  assert.equal((await app.call('DELETE', `${D}/${s}/ops?anchor=rel:${planned.id}`)).status, 200);
  assert.deepEqual(await get(`${E}/flow-relations?draft=${s}`), []);
  const r = await app.call('POST', `${D}/${s}/plan/links`, {});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual(r.body.links, { abstract: 2, flow: 1, skipped: 0 }, 'the plan-wide counts; only the relation was missing from the draft');
  assert.equal((await get(`${E}/flow-relations?draft=${s}`)).length, 1);
  assert.equal((await app.call('POST', `${D}/${s}/plan/links`, {})).status, 409, 'nothing left to add');
});

test('MCP: list_flow_relations equals REST; edit_design writes an AI edit; the filter and the sealed answer', async () => {
  assert.deepEqual((await mcp('list_flow_relations', { env: 'sase-hld', draft: 'hld-import' })).json, await get(`${E}/flow-relations?draft=hld-import`));
  assert.deepEqual((await mcp('list_flow_relations', { env: 'sase-hld', draft: 'hld-import', service: 'sase-agent', ingress: 'in.tunnel.open', type: 'same-topic' })).json.length, 1);
  assert.deepEqual((await mcp('list_flow_relations', { env: 'prod' })).json, []);
  assert.equal((await mcp('list_flow_relations', { env: 'sase-hld', service: 'x' })).isError, true);
  const s = await fresh();
  const w = await mcp('edit_design', { env: 'sase-hld', draft: s, edit: { kind: 'flow-relation', from: TUN, to: VER, type: 'variant', note: 'n' } });
  assert.equal(w.isError, false);
  assert.equal((await mcp('list_flow_relations', { env: 'sase-hld', draft: s, type: 'variant-of' })).json.length, 1, 'the alias is the type');
  const ops = (await get(`${D}/${s}`)).ops;
  assert.ok(ops.filter((o: any) => o.anchor.startsWith('rel:') && o.data.type === 'variant-of').every((o: any) => o.byAi && o.author === 'assistant'));
});

test('apply writes flow_relations (the plan relation and ours); marks stay new; a Full copy carries them; deleting the env drops them; deleting one applies', async () => {
  const s = await fresh();
  await edit(s, { kind: 'flow-relation', from: TUN, to: VER, type: 'supersedes', note: 'v2' });
  const ap = await app.call('POST', `${D}/${s}/apply`, { by: 'ana' });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const q = (env: string) => app.ctx.db.prepare('SELECT * FROM flow_relations WHERE env = ? ORDER BY type').all(env) as any[];
  const rows = q('sase-hld');
  assert.deepEqual(rows.map((r) => [r.from_service, r.from_ingress, r.to_service, r.to_ingress, r.type, r.note, r.author]), [
    ['auth-svc', 'in.token.device', 'sase-agent', 'in.tunnel.open', 'same-topic', 'The tunnel set-up calls the device token endpoint: read the two together.', 'ana'],
    ['sase-agent', 'in.tunnel.open', 'auth-svc', 'in.verify', 'supersedes', 'v2', 'ana']]);
  assert.equal((await get(`${E}/flow-relations`)).length, 2, 'the design has them now');
  assert.deepEqual((await get(`${E}/marks`)).counts.relations, { new: 2, changed: 0, removed: 0 }, 'a design-made relation stays new against the baseline');
  const full = await app.call('POST', '/api/envs', { name: 'rel-copy', source: 'sase-hld', mode: 'full' });
  assert.equal(full.status, 201, JSON.stringify(full.body));
  assert.equal(q('rel-copy').length, 2); assert.equal((await get('/api/envs/rel-copy/flow-relations')).length, 2);
  assert.equal((await app.call('DELETE', '/api/envs/rel-copy')).status, 200);
  assert.equal(q('rel-copy').length, 0);
  const s2 = await fresh(false);
  const sup = (await get(`${E}/flow-relations?draft=${s2}&type=supersedes`))[0];
  await edit(s2, { kind: 'flow-relation', id: sup.id, from: TUN, to: VER, type: 'supersedes', note: 'v3' });
  assert.equal((await get(`${E}/flow-relations?draft=${s2}&type=supersedes`))[0].note, 'v3');
  await edit(s2, { kind: 'delete', anchor: `rel:${(await get(`${E}/flow-relations?draft=${s2}&type=same-topic`))[0].id}` });
  assert.equal((await app.call('POST', `${D}/${s2}/apply`, { by: 'ana' })).status, 200);
  assert.deepEqual(q('sase-hld').map((r) => [r.type, r.note]), [['supersedes', 'v3']]);
});
