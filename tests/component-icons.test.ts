// Component icons (CR #144): the value rules (core/component-icons.ts), the edit form's BAD_ICON, the ingest check, and the round trip over HTTP and MCP.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BUILTIN_ICONS, BUILTIN_ICON_GROUPS, MAX_ICON, iconKind, iconOf, iconProblem, iconSrc, iconTile, searchIcons } from '../core/component-icons.ts';
import { designEditOps } from '../core/design-edit.ts';
import { rows } from './subsystem-fixture.ts';
import { SAMPLES, startApp } from './helpers.ts';
import { seedEnvRecipes } from '../scripts/seed-envs.ts';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><polygon points="8,1.5 14,5 14,11 8,14.5 2,11 2,5" fill="#6b7280"/></svg>';
const fail = (f: () => unknown) => { try { f(); } catch (e: any) { return `${e.code}${e.field ? `:${e.field}` : ''}`; } return 'no error'; };

test('built-in names, an <svg> string and a data URL are valid; everything else is a problem that lists the built-ins', () => {
  for (const n of BUILTIN_ICONS) assert.equal(iconProblem(n), null, n);
  assert.ok(BUILTIN_ICONS.includes('vault') && BUILTIN_ICONS.includes('auth0') && BUILTIN_ICONS.includes('aws-lambda') && BUILTIN_ICONS.includes('kafka'));
  assert.equal(iconProblem(SVG), null);
  assert.equal(iconProblem(`<?xml version="1.0"?>\n${SVG}\n`), null);
  assert.equal(iconProblem('data:image/png;base64,iVBORw0KGgo='), null);
  assert.equal(iconProblem(`data:image/svg+xml;utf8,${encodeURIComponent(SVG)}`), null);
  assert.equal(iconProblem(`data:image/svg+xml;base64,${Buffer.from(SVG).toString('base64')}`), null);
  const unknown = iconProblem('foo-bar')!;
  assert.match(unknown, /unknown icon 'foo-bar'/); assert.match(unknown, /vault/); assert.match(unknown, /aws-lambda/);
  for (const v of ['', '   ', 42, null, {}] as unknown[]) assert.notEqual(iconProblem(v), null);
});

test('an SVG with a script, an event attribute, an external reference or a DOCTYPE is refused (also inside a data URL)', () => {
  const bad = [
    '<svg viewBox="0 0 1 1"><script>alert(1)</script></svg>',
    '<svg viewBox="0 0 1 1" onload="alert(1)"></svg>',
    '<svg viewBox="0 0 1 1"><rect onclick = "x()"/></svg>',
    '<svg viewBox="0 0 1 1"><image href="https://evil.example/x.png"/></svg>',
    '<svg viewBox="0 0 1 1" xmlns:xlink="http://www.w3.org/1999/xlink"><use xlink:href="http://evil.example/a.svg#x"/></svg>',
    '<svg viewBox="0 0 1 1"><a href="javascript:alert(1)"><rect/></a></svg>',
    '<svg viewBox="0 0 1 1"><foreignObject><div/></foreignObject></svg>',
    '<svg viewBox="0 0 1 1"><rect style="fill:url(https://evil.example/x)"/></svg>',
    '<!DOCTYPE svg><svg viewBox="0 0 1 1"></svg>',
    '<svg viewBox="0 0 1 1"><rect/>',
  ];
  for (const v of bad) assert.notEqual(iconProblem(v), null, v);
  for (const v of bad.slice(0, 4)) assert.notEqual(iconProblem(`data:image/svg+xml;base64,${Buffer.from(v).toString('base64')}`), null, `data: ${v}`);
  assert.notEqual(iconProblem(`data:image/svg+xml,${encodeURIComponent(bad[0])}`), null);
  assert.equal(iconProblem('<svg viewBox="0 0 1 1"><defs><linearGradient id="g"/></defs><rect fill="url(#g)"/><use href="#g"/></svg>'), null, 'internal references are fine');
  assert.notEqual(iconProblem('data:text/html;base64,PGgxPg=='), null, 'only images');
});

test('size limit: 16 KB', () => {
  assert.equal(MAX_ICON, 16384);
  const fat = `<svg viewBox="0 0 1 1"><path d="${'M0 0'.repeat(MAX_ICON)}"/></svg>`;
  assert.match(iconProblem(fat)!, /at most 16384/);
  assert.match(iconProblem(`data:image/png;base64,${'A'.repeat(MAX_ICON)}`)!, /at most 16384/);
});

test('helpers: kind, src (a user SVG is a data: URL, never markup), tile, header read, search', () => {
  assert.deepEqual(['vault', SVG, 'data:image/png;base64,AA', 'nope'].map(iconKind), ['builtin', 'svg', 'data', null]);
  assert.equal(iconSrc('aws-s3'), 'icons/aws-s3.svg');
  assert.match(iconSrc('<svg viewBox="0 0 1 1"></svg>')!, /^data:image\/svg\+xml;charset=utf-8,%3Csvg%20xmlns%3D/, 'the namespace is added');
  assert.deepEqual(['vault', 'kafka', 'mysql', 'aws-lambda', 'auth0', SVG].map(iconTile), ['slate', 'white-dark', 'white-dark', null, null, 'white']);
  assert.equal(iconOf({ details: { icon: 'vault' } }), 'vault');
  assert.equal(iconOf({ details: { icon: 'rocket' } }), null, 'a bad stored value is never drawn');
  assert.equal(iconOf({}), null);
  assert.deepEqual(searchIcons('queue').flatMap(([, i]) => i.map(([n]) => n)).sort(), ['aws-sqs', 'kafka', 'rabbitmq'], 'a search also matches what the product is');
  assert.ok(searchIcons('sqs').some(([g, i]) => g.includes('Application integration') && i.some(([n]) => n === 'aws-sqs')));
  assert.equal(searchIcons('aws sec').length, 1, 'words must all match, empty groups are dropped');
  assert.equal(searchIcons('').length, BUILTIN_ICON_GROUPS.length);
  assert.equal(searchIcons('zzzz').length, 0);
});

test('the built-in set is a file each, in web/icons, and the README names its source', () => {
  const have = new Set(readdirSync(join(import.meta.dirname, '../web/icons')));
  for (const n of BUILTIN_ICONS) assert.ok(have.has(`${n}.svg`), `${n}.svg`);
  const readme = readFileSync(join(import.meta.dirname, '../web/icons/README.md'), 'utf8');
  assert.match(readme, /auth0\.svg/); assert.match(readme, /#EB5424/);
});

test('component edit: icon sets details.icon (kept beside the other details), null clears, BAD_ICON names the field', () => {
  const rs = rows();
  const set = designEditOps({ kind: 'component', name: 'auth-svc', serviceKind: 'service', icon: 'auth0' }, rs);
  assert.equal((set[0].data as any).details.icon, 'auth0');
  const custom = designEditOps({ kind: 'component', name: 'auth-svc', serviceKind: 'service', icon: SVG }, rs);
  assert.equal((custom[0].data as any).details.icon, SVG);
  const withIcon = rs.map((r) => (r.service === 'auth-svc' && r.list === 'header' ? { ...r, data: { ...r.data, details: { runtime: 'k8s-pod', icon: 'vault' } } } : r));
  assert.deepEqual((designEditOps({ kind: 'component', name: 'auth-svc', serviceKind: 'service', icon: null }, withIcon)[0].data as any).details, { runtime: 'k8s-pod' });
  assert.deepEqual((designEditOps({ kind: 'component', name: 'auth-svc', serviceKind: 'service', team: 'x' }, withIcon)[0].data as any).details, { runtime: 'k8s-pod', icon: 'vault' }, 'left out: kept');
  assert.equal(fail(() => designEditOps({ kind: 'component', name: 'auth-svc', serviceKind: 'service', icon: 'foo-bar' }, rs)), 'BAD_ICON:icon');
  assert.equal(fail(() => designEditOps({ kind: 'component', name: 'auth-svc', serviceKind: 'service', icon: '<svg><script/></svg>' }, rs)), 'BAD_ICON:icon');
  assert.equal(fail(() => designEditOps({ kind: 'component', name: 'auth-svc', serviceKind: 'service', icon: `<svg>${'x'.repeat(MAX_ICON)}</svg>` }, rs)), 'BAD_ICON:icon');
});

// ---- over HTTP / MCP ----
const all = (d: string) => readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')));
let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: [...all(SAMPLES), ...all(join(SAMPLES, 'deltas'))] })).status, 201);
  seedEnvRecipes(app.ctx, join(SAMPLES, 'envs'));
});
after(() => app.close());

test('ingest: details.icon is stored and read back in services, the system graph and the subsystem rows; a bad one is 422 BAD_ICON', async () => {
  const m = JSON.parse(readFileSync(join(SAMPLES, 'lo-idp.json'), 'utf8'));
  assert.equal(m.service.details.icon, 'auth0');
  const svcs = (await app.call('GET', '/api/envs/prod/services')).body as any[];
  assert.equal(svcs.find((s) => s.name === 'lo-idp').details.icon, 'auth0');
  assert.equal(svcs.find((s) => s.name === 'lo-ic-brand').details.icon.startsWith('<svg'), true);
  const sys = (await app.call('GET', '/api/envs/prod/views/system')).body;
  assert.equal(sys.nodes.find((n: any) => n.id === 'svc:lo-idp').icon, 'auth0');
  assert.equal(sys.nodes.find((n: any) => n.id === 'svc:lo-n-vault').icon, 'vault');
  assert.equal(sys.nodes.find((n: any) => n.id === 'svc:billing-api').icon, undefined, 'no icon: nothing added');
  for (const icon of ['foo-bar', '<svg viewBox="0 0 1 1"><script>x</script></svg>', `<svg>${'x'.repeat(MAX_ICON)}</svg>`]) {
    const r = await app.call('POST', '/api/ingest', { manifests: [{ ...m, version: 99, service: { ...m.service, details: { icon } } }] });
    assert.equal(r.status, 422, icon.slice(0, 20));
    assert.ok(['BAD_ICON', 'INVALID'].includes(r.body.error.code), JSON.stringify(r.body.error).slice(0, 200));
  }
  const bad = await app.call('POST', '/api/ingest', { manifests: [{ ...m, version: 99, service: { ...m.service, details: { icon: 'foo-bar' } } }] });
  assert.equal(bad.body.error.code, 'BAD_ICON'); assert.match(bad.body.error.message, /aws-lambda/);
  const ok = await app.call('POST', '/api/ingest', { manifests: [{ ...m, version: 99, service: { ...m.service, details: { icon: 'kafka' } } }] });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(((await app.call('GET', '/api/envs/prod/services')).body as any[]).find((s) => s.name === 'lo-idp').details.icon, 'kafka');
});

const D = '/api/envs/sase-hld/drafts';
test('design edit over REST and MCP: set, read back from the draft, BAD_ICON 422, clear, apply', async () => {
  assert.equal((await app.call('POST', D, { name: 'ic', slug: 'ic' })).status, 201);
  const svc = ((await app.call('GET', '/api/envs/sase-hld/services')).body as any[]).find((s) => s.name === 'swg-api');
  const edit = (e: unknown, slug = 'ic') => app.call('POST', `${D}/${slug}/edits`, { edit: e });
  const base = { kind: 'component', name: 'swg-api', serviceKind: svc.kind };
  const bad = await edit({ ...base, icon: 'foo-bar' });
  assert.equal(bad.status, 422); assert.equal(bad.body.error.code, 'BAD_ICON'); assert.equal(bad.body.error.details?.field, 'icon');
  assert.equal((await edit({ ...base, icon: '<svg viewBox="0 0 1 1" onload="x()"></svg>' })).status, 422);
  assert.equal((await edit({ ...base, icon: 'aws-lambda' })).status, 201);
  const inDraft = ((await app.call('GET', '/api/envs/sase-hld/services?draft=ic')).body as any[]).find((s) => s.name === 'swg-api');
  assert.equal(inDraft.details.icon, 'aws-lambda'); assert.equal(inDraft.groupPath, svc.groupPath, 'the other fields stay');
  const raw = await app.call('POST', `${D}/ic/ops`, { ops: [{ op: 'upsert', anchor: 'svc:swg-api', data: { kind: svc.kind, details: { icon: 'nope' } } }] });
  assert.equal(raw.status, 422); assert.equal(raw.body.error.code, 'BAD_ICON');
  const r = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'edit_design', arguments: { env: 'sase-hld', draft: 'ic', edit: { ...base, icon: 'rocket' } } } });
  assert.equal(r.body.result.isError, true); assert.match(r.body.result.content[0].text, /BAD_ICON/);
  const ap = await app.call('POST', `${D}/ic/apply`, { by: 'ana' });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal(((await app.call('GET', '/api/envs/sase-hld/views/system')).body.nodes as any[]).find((n) => n.id === 'svc:swg-api').icon, 'aws-lambda');
  assert.equal((await app.call('POST', D, { name: 'ic2', slug: 'ic2' })).status, 201);
  assert.equal((await edit({ ...base, icon: null }, 'ic2')).status, 201);
  assert.equal(((await app.call('GET', '/api/envs/sase-hld/services?draft=ic2')).body as any[]).find((s) => s.name === 'swg-api').details?.icon, undefined);
});

test('the browser helpers (web/js/components/icon-src.js, no imports) agree with the core ones on every valid value', async () => {
  const W = await import('../web/js/components/icon-src.js');
  const values = [...BUILTIN_ICONS, SVG, `<?xml version="1.0"?>${SVG}`, 'data:image/png;base64,AA'];
  for (const v of values) {
    assert.equal(W.iconKind(v), iconKind(v), v.slice(0, 30)); assert.equal(W.iconSrc(v), iconSrc(v)); assert.equal(W.iconTile(v), iconTile(v));
    assert.equal(W.iconOf({ details: { icon: v } }), v);
  }
  assert.equal(W.iconOf({}), null);
});

test('lifeline heads: an own icon wins over the product icon of the kind; without one, today\'s icon', async () => {
  const { headIconOf } = await import('../web/js/views/flow-draw-icons.js');
  const { setServiceInfo } = await import('../web/js/design/service-info.js');
  setServiceInfo([{ name: 'ic-l', kind: 'lambda', details: { icon: 'vault' } }, { name: 'ic-p', kind: 'lambda' }, { name: 'ic-c', kind: 'service', details: { icon: SVG } }], 'e1');
  const head = (service: string, serviceKind: string) => headIconOf({ kind: 'service', service, env: 'e1', serviceKind } as any);
  assert.deepEqual(head('ic-l', 'lambda'), ['own', 'vault']);
  assert.deepEqual(head('ic-p', 'lambda'), ['service', 'lambda']);
  assert.deepEqual(head('ic-c', 'service'), ['own', SVG]);
  assert.equal(head('none', 'service'), null);
});
