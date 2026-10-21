// The subsystem level over HTTP and MCP (0.28.0), on the demo design sase-hld and its draft hld-import: reads, edits and apply, settings,
// plan/links, copies, delete, MCP parity. The mutating tests come last (an apply changes the design).

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
  return { isError: r.body.result.isError as boolean, text: r.body.result.content[0].text as string, json: r.body.result.isError ? null : JSON.parse(r.body.result.content[0].text) };
};
let n = 0;
const fresh = async () => { const slug = `s${++n}`; assert.equal((await app.call('POST', D, { name: slug, slug })).status, 201); return slug; };
const edit = (slug: string, e: unknown) => app.call('POST', `${D}/${slug}/edits`, { edit: e });

test('GET subsystems: a sealed env derives them from groupPaths; the design has settings (icons, order); a draft adds what it brings', async () => {
  const prod = await get('/api/envs/prod/subsystems');
  assert.deepEqual(Object.keys(prod).sort(), ['levels', 'notSet', 'subsystems']);
  assert.ok(prod.subsystems.every((s: any) => s.derived && s.icon === null));
  const d = await get(`${E}/subsystems`);
  assert.deepEqual(d.subsystems.map((s: any) => [s.key, s.label, s.icon, s.order, s.derived]), [['agent', 'Agent', 'agent', 0, false], ['network', 'Network (POP)', 'network', 1, false], ['platform', 'Platform', 'platform', 2, false]]);
  assert.deepEqual(d.subsystems[1].components.map((c: any) => c.name), ['swg-api', 'sxdns']);
  assert.deepEqual(d.subsystems[0].components, []);
  const dr = await get(`${E}/subsystems?draft=hld-import`);
  assert.deepEqual(dr.subsystems[0].components.map((c: any) => c.name), ['sase-agent']);
  assert.ok(dr.subsystems[1].components.some((c: any) => c.name === 'pop-edge'));
  assert.equal((await app.call('GET', `${E}/subsystems?draft=nope`)).status, 404);
});

test('GET views/subsystems with and without the draft: boxes in settings order, lines, the links of the plan', async () => {
  const plain = await get(`${E}/views/subsystems`);
  assert.deepEqual(plain.boxes.map((b: any) => b.key).slice(0, 3), ['agent', 'network', 'platform']);
  assert.deepEqual(plain.abstract, []);
  const m = await get(`${E}/views/subsystems?draft=hld-import`);
  assert.ok(m.lines.some((l: any) => l.from === 'agent' && l.to === 'network'), 'sase-agent calls pop-edge');
  assert.ok(m.lines.some((l: any) => l.from === 'network' && l.to === 'platform'));
  assert.deepEqual(m.abstract.map((v: any) => [v.id, v.state]), [['push-config-update', 'abstract'], ['usage-metering', 'abstract']]);
  assert.equal(m.lines.reduce((s: number, l: any) => s + l.count, 0) + m.boxes.reduce((s: number, b: any) => s + b.internal, 0) > 0, true);
});

test('abstract links: the list (with ?subsystem=), one with its suggestions, 404 for an unknown id', async () => {
  const list = await get(`${E}/abstract-links?draft=hld-import`);
  assert.equal(list.length, 2);
  assert.deepEqual((await get(`${E}/abstract-links?draft=hld-import&subsystem=agent`)).map((v: any) => v.id), ['push-config-update']);
  const one = await get(`${E}/abstract-links/usage-metering?draft=hld-import`);
  assert.deepEqual([one.state, one.from.anchor, one.to.anchor, one.mode], ['abstract', 'grp:network', 'grp:platform', 'async']);
  assert.ok(Array.isArray(one.suggestions) && one.suggestions.length <= 5 && one.suggestions.every((s: any) => s.reason));
  assert.ok(one.suggestions.some((s: any) => s.use), 'existing calls network -> platform are offered');
  assert.equal((await app.call('GET', `${E}/abstract-links/none?draft=hld-import`)).status, 404);
  assert.deepEqual((await get('/api/envs/prod/abstract-links')), []);
});

test('marks of the draft: grp:agent is new (only sase-agent, new), the others change, links are new; counts carry subsystems and links', async () => {
  const m = await get(`${E}/marks?draft=hld-import`);
  assert.deepEqual(m.marks['grp:agent'], { mark: 'new', what: 'whole subsystem new' });
  assert.equal(m.marks['grp:platform'].mark, 'changed'); assert.equal(m.marks['grp:network'].mark, 'changed');
  assert.equal(m.marks['link:usage-metering'].mark, 'new');
  assert.deepEqual([m.counts.subsystems.new, m.counts.subsystems.changed, m.counts.links.new], [1, 2, 2]);
  assert.equal((await get(`${E}/marks`)).marks['grp:agent'], undefined, 'without the draft nothing changed');
});

test('PUT subsystems: sealed ok (order, icon), a design is 409 USE_DRAFT; PUT levels on any env; bad input is 422', async () => {
  const put = await app.call('PUT', '/api/envs/prod/subsystems', { subsystems: [{ key: 'core', label: 'Core', icon: 'shield' }, { key: 'edge', label: 'Edge' }] });
  assert.equal(put.status, 200); assert.deepEqual(put.body.subsystems, [{ key: 'core', label: 'Core', icon: 'shield' }, { key: 'edge', label: 'Edge' }]);
  assert.deepEqual((await get('/api/envs/prod/subsystems')).subsystems.slice(0, 2).map((s: any) => [s.key, s.derived, s.order]), [['core', false, 0], ['edge', false, 1]]);
  assert.equal((await get('/api/envs/meta')).find((e: any) => e.name === 'prod').groups[0].icon, 'shield');
  const d = await app.call('PUT', `${E}/subsystems`, { subsystems: [] });
  assert.equal(d.status, 409); assert.equal(d.body.error.code, 'USE_DRAFT');
  assert.equal((await app.call('PUT', '/api/envs/prod/subsystems', { subsystems: [{ key: 'x', label: '', icon: 'shield' }] })).status, 422);
  assert.equal((await app.call('PUT', '/api/envs/prod/subsystems', { subsystems: [{ key: 'x', label: 'X', icon: 'rocket' }] })).status, 422);
  assert.equal((await app.call('PUT', '/api/envs/prod/subsystems', { subsystems: [{ key: 'x', label: 'X' }, { key: 'x', label: 'Y' }] })).status, 422);
  for (const env of ['prod', 'sase-hld']) assert.deepEqual((await app.call('PUT', `/api/envs/${env}/levels`, { levels: ['System', 'Part'] })).body, { levels: ['System', 'Part'] });
  assert.equal((await get(`${E}/subsystems`)).levels[0], 'System');
  assert.equal((await app.call('PUT', `${E}/levels`, { levels: [] })).status, 422);
  assert.equal((await app.call('PUT', `${E}/levels`, { levels: ['a', 'b', 'c', 'd', 'e'] })).status, 422);
  assert.equal((await app.call('PUT', `${E}/levels`, { levels: ['x'.repeat(41)] })).status, 422);
  assert.equal((await app.call('PUT', '/api/envs/prod/subsystems', { subsystems: [] })).status, 200);
});

test('plan/links: the links of a kept plan into a draft (201, then 409 NO_CHANGE); from = another draft; refused in a sealed env', async () => {
  const slug = await fresh();
  assert.equal((await app.call('POST', `${D}/${slug}/plan`, plan())).status, 201);
  for (const a of ['usage-metering', 'push-config-update']) assert.equal((await app.call('DELETE', `${D}/${slug}/ops?anchor=link:${a}`)).status, 200);
  assert.equal((await get(`${E}/abstract-links?draft=${slug}`)).length, 0, 'a draft imported before 0.28 has the links kept, not applied');
  const r = await app.call('POST', `${D}/${slug}/plan/links`, {});
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.deepEqual([r.body.from, r.body.to, r.body.links, r.body.counts.added > 0], [slug, slug, { abstract: 2, flow: 1, skipped: 0 }, true]);
  assert.equal((await get(`${E}/abstract-links?draft=${slug}`)).length, 2);
  const again = await app.call('POST', `${D}/${slug}/plan/links`, {});
  assert.equal(again.status, 409); assert.equal(again.body.error.code, 'NO_CHANGE');
  const other = await fresh();
  const via = await app.call('POST', `${D}/${other}/plan/links`, { from: 'hld-import' });
  assert.equal(via.status, 201); assert.equal(via.body.from, 'hld-import'); assert.equal(via.body.to, other);
  assert.equal((await app.call('POST', `${D}/${other}/plan/links`, { from: 'nope' })).status, 404);
  assert.equal((await app.call('POST', `${D}/${await fresh()}/plan/links`, {})).status, 404, 'a draft with no kept plan');
  assert.equal((await app.call('POST', '/api/envs/prod/drafts/x/plan/links', {})).status, 409);
});

test('plan import refuses a second subsystem: TWO_GROUPS for two groupPaths of one component and for details.alsoIn, nothing appended', async () => {
  const p = plan();
  const slug = await fresh();
  const twice = { ...p, extensions: [...p.extensions, { service: 'sase-agent', groupPath: 'platform', upsert: {} }] };
  const r = await app.call('POST', `${D}/${slug}/plan`, twice);
  assert.equal(r.status, 422); assert.equal(r.body.error.code, 'TWO_GROUPS'); assert.match(r.body.error.message, /sase-agent.*agent.*platform|two subsystems/);
  const also = JSON.parse(JSON.stringify(p)); also.manifests[0].service.details = { alsoIn: ['platform'] };
  const r2 = await app.call('POST', `${D}/${slug}/plan`, also);
  assert.equal(r2.status, 422); assert.equal(r2.body.error.code, 'TWO_GROUPS'); assert.match(r2.body.error.message, /pick one/);
  assert.equal((await get(`${D}/${slug}`)).ops.length, 0);
  const ops = await app.call('POST', `${D}/${slug}/ops`, { ops: [{ op: 'upsert', anchor: 'svc:users-svc', data: { kind: 'service', groupPath: 'platform' } }, { op: 'upsert', anchor: 'svc:users-svc', data: { kind: 'service', groupPath: 'agent' } }] });
  assert.equal(ops.status, 422); assert.equal(ops.body.error.code, 'TWO_GROUPS');
});

test('edits then apply: icon and order reach envs.groups, the link is a row, /meta shows the icon; marks keep the link new, a reorder marks nothing', async () => {
  const s = await fresh();
  assert.equal((await edit(s, { kind: 'subsystem', key: 'agent', icon: 'cloud' })).status, 201);
  assert.equal((await edit(s, { kind: 'abstract-link', name: 'agent to platform', from: 'grp:agent', to: 'grp:platform', mode: 'sync' })).status, 201);
  const bad = await edit(s, { kind: 'subsystem', key: 'agent', icon: 'rocket' });
  assert.equal(bad.status, 422); assert.equal(bad.body.error.code, 'BAD_ICON');
  const del = await edit(s, { kind: 'delete', anchor: 'grp:platform' });
  assert.equal(del.status, 422); assert.equal(del.body.error.code, 'GROUP_IN_USE');
  const ap = await app.call('POST', `${D}/${s}/apply`, { by: 'ana' });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const meta = (await get(`${E}/meta`)).groups;
  assert.deepEqual(meta.map((g: any) => [g.key, g.icon]), [['agent', 'cloud'], ['network', 'network'], ['platform', 'platform']]);
  assert.equal(app.ctx.db.prepare("SELECT count(*) AS n FROM abstract_links WHERE env = 'sase-hld'").get()!.n, 1);
  assert.equal((await get(`${E}/abstract-links/agent-to-platform`)).state, 'abstract');
  const marks = (await get(`${E}/marks`)).marks;
  assert.equal(marks['link:agent-to-platform'].mark, 'new'); assert.equal(marks['grp:agent'].what, '+1 link · icon');
  const s2 = await fresh();
  assert.equal((await edit(s2, { kind: 'subsystem', key: 'platform', order: 0 })).status, 201);
  assert.equal((await app.call('POST', `${D}/${s2}/apply`, { by: 'ana' })).status, 200);
  assert.deepEqual((await get(`${E}/meta`)).groups.map((g: any) => g.key), ['platform', 'agent', 'network']);
  const after = (await get(`${E}/marks`)).marks;
  assert.deepEqual(after['grp:platform'], { mark: 'changed', what: '+1 link' }, 'reordering adds nothing: only the link into it');
  assert.equal(after['grp:network'], undefined, 'reordering marks nothing');
  assert.equal(after['link:agent-to-platform'].mark, 'new', 'a design-made link stays new against the baseline');
  assert.equal((await get(`${E}/marks?against=source`)).marks['link:agent-to-platform'].mark, 'new', 'and against the source');
});

test('copies: a Full copy of a design carries its links and baseline groups; a Components copy none; delete drops the links', async () => {
  const q = (name: string) => app.ctx.db.prepare('SELECT (SELECT count(*) FROM abstract_links WHERE env = ?) AS l, (SELECT baseline_groups FROM envs WHERE name = ?) AS b, (SELECT groups FROM envs WHERE name = ?) AS g').get(name, name, name) as any;
  const full = await app.call('POST', '/api/envs', { name: 'full-copy', source: 'sase-hld', mode: 'full' });
  assert.equal(full.status, 201, JSON.stringify(full.body));
  assert.equal(q('full-copy').l, 1); assert.equal(q('full-copy').b, q('sase-hld').b);
  assert.deepEqual(JSON.parse(q('full-copy').g).map((g: any) => g.key), ['platform', 'agent', 'network'], 'the order and icons come along');
  assert.equal((await get('/api/envs/full-copy/abstract-links')).length, 1);
  const comp = await app.call('POST', '/api/envs', { name: 'comp-copy', source: 'sase-hld', mode: 'components', groups: [{ key: 'agent', label: 'Agent', icon: 'agent' }], services: [{ name: 'auth-svc', groupPath: 'agent' }] });
  assert.equal(comp.status, 201, JSON.stringify(comp.body));
  assert.equal(q('comp-copy').l, 0); assert.equal(q('comp-copy').b, q('comp-copy').g, 'a new design starts with its groups as the baseline');
  assert.equal((await app.call('POST', '/api/envs', { name: 'bad-icon', source: 'prod', mode: 'blank', groups: [{ key: 'a', label: 'A', icon: 'rocket' }] })).status, 422);
  assert.equal((await app.call('DELETE', '/api/envs/full-copy')).status, 200);
  assert.equal(q('full-copy').l, 0);
  assert.equal(app.ctx.db.prepare("SELECT count(*) AS n FROM flow_relations WHERE env = 'full-copy'").get()!.n, 0);
});

test('MCP: the reads equal REST, the writes are AI edits, set_subsystem_settings works sealed and (with a draft) in a design', async () => {
  const slug = await fresh();
  assert.deepEqual((await mcp('get_subsystems', { env: 'sase-hld', draft: 'hld-import' })).json, await get(`${E}/subsystems?draft=hld-import`));
  assert.deepEqual((await mcp('get_subsystem_map', { env: 'sase-hld', draft: 'hld-import' })).json, await get(`${E}/views/subsystems?draft=hld-import`));
  assert.deepEqual((await mcp('list_abstract_links', { env: 'sase-hld', draft: 'hld-import', subsystem: 'agent' })).json, await get(`${E}/abstract-links?draft=hld-import&subsystem=agent`));
  assert.deepEqual((await mcp('suggest_refinements', { env: 'sase-hld', draft: 'hld-import', id: 'usage-metering' })).json, (await get(`${E}/abstract-links/usage-metering?draft=hld-import`)).suggestions);
  assert.equal((await mcp('suggest_refinements', { env: 'sase-hld', id: 'nope' })).isError, true);
  const e = await mcp('edit_design', { env: 'sase-hld', draft: slug, edit: { kind: 'abstract-link', name: 'm link', from: 'grp:network', to: 'grp:agent' } });
  assert.equal(e.isError, false, e.text);
  const ops = (await get(`${D}/${slug}`)).ops;
  assert.ok(ops.every((o: any) => o.byAi && o.author === 'assistant'));
  const set = await mcp('set_subsystem_settings', { env: 'sase-hld', draft: slug, subsystems: [{ key: 'network', label: 'Network', icon: 'shield' }] });
  assert.equal(set.isError, false, set.text);
  assert.equal((await get(`${E}/subsystems?draft=${slug}`)).subsystems.find((s: any) => s.key === 'network').label, 'Network');
  assert.equal((await mcp('set_subsystem_settings', { env: 'sase-hld', subsystems: [] })).isError, true, 'a design needs a draft');
  assert.equal((await mcp('set_subsystem_settings', { env: 'prod', subsystems: [{ key: 'core', label: 'Core' }] })).isError, false);
  assert.equal((await mcp('set_levels', { env: 'prod', levels: ['One', 'Two'] })).json.levels[1], 'Two');
  const pl = await mcp('apply_plan_links', { env: 'sase-hld', draft: slug, from: 'hld-import' });
  assert.equal(pl.isError, false, pl.text); assert.equal(pl.json.links.abstract, 2);
  assert.ok((await get(`${D}/${slug}`)).ops.filter((o: any) => o.anchor.startsWith('link:')).every((o: any) => o.byAi));
});
