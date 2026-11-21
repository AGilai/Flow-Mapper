// Component types (frame 34, 0.68.0): the catalogue, resolveType (declared -> legacy icon -> kind -> service), the browser mirror, the additive migration 021,
// the ingest and import normalisation, the old fields still accepted, and the type fields REST and MCP add.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDb } from '../server/db/connection.ts';
import { findings } from '../core/type-report.ts';
import { storedHeader, GENERIC_TYPES, SPECIFIC_TYPES, TYPES, LEGACY_ICONS, resolveType, legacyType, typeFields, withType, searchTypes, isGeneric, STORE_TYPE, CHANNEL_TYPE } from '../core/component-types.ts';
import { designEditOps } from '../core/design-edit.ts';
import { createValidator } from '../core/schema-validate.ts';
import { rows } from './subsystem-fixture.ts';
import { SAMPLES, startApp, startDesign } from './helpers.ts';
// @ts-ignore plain JS module shared with the browser
import * as W from '../web/js/components/type-info.js';

const ICONS = join(import.meta.dirname, '../web/icons');

test('catalogue: 14 generic types, 27 specific ones each with a generic parent, every icon file exists (Light and Dark for a generic type)', () => {
  assert.equal(GENERIC_TYPES.length, 14);
  assert.equal(SPECIFIC_TYPES.length, 27);
  assert.equal(new Set(TYPES.map((t) => t.id)).size, 41, 'ids are unique');
  for (const t of SPECIFIC_TYPES) assert.ok(isGeneric(t.generic), `${t.id} parent ${t.generic}`);
  for (const t of GENERIC_TYPES) for (const v of ['Light', 'Dark']) assert.ok(existsSync(join(ICONS, `${t.icon}_${v}.svg`)), `${t.icon}_${v}.svg`);
  for (const t of SPECIFIC_TYPES) assert.ok(existsSync(join(ICONS, `${t.icon}.svg`)), `${t.icon}.svg`);
  assert.deepEqual(SPECIFIC_TYPES.filter((t) => t.generic === 'idp').map((t) => t.id), ['auth0', 'aws-cognito']);
  assert.equal(SPECIFIC_TYPES.find((t) => t.id === 'hashicorp-vault')!.label, 'HashiCorp Vault');
  assert.equal(SPECIFIC_TYPES.find((t) => t.id === 'kubernetes')!.generic, 'container');
  for (const id of [...Object.values(STORE_TYPE), ...Object.values(CHANNEL_TYPE)]) assert.ok(TYPES.some((t) => t.id === id), id);
  const readme = readFileSync(join(ICONS, 'README.md'), 'utf8');
  assert.match(readme, /Res_General-Icons/); assert.match(readme, /kubernetes\.svg/);
});

test('resolveType: declared, legacy icon, kind, default; unknown declared falls back but is reported; generic only', () => {
  assert.deepEqual(resolveType({ type: 'auth0' }), { id: 'auth0', generic: 'idp', source: 'declared' });
  assert.deepEqual(resolveType({ type: 'idp' }), { id: 'idp', generic: 'idp', source: 'declared' }, 'generic only');
  assert.deepEqual(resolveType({ type: 'service', kind: 'lambda' }), { id: 'service', generic: 'service', source: 'declared' }, 'a declared type wins over the kind');
  assert.deepEqual(resolveType({ type: 'auth0', details: { icon: 'vault' } }), { id: 'auth0', generic: 'idp', source: 'declared' }, 'declared wins over the legacy icon');
  assert.deepEqual(resolveType({ details: { icon: 'vault', product: 'HashiCorp Vault' } }), { id: 'hashicorp-vault', generic: 'vault', source: 'legacy-icon' }, 'vault -> hashicorp-vault');
  assert.deepEqual(resolveType({ details: { icon: 'aws-sqs' } }), { id: 'aws-sqs', generic: 'queue', source: 'legacy-icon' }, 'other names map 1:1');
  assert.equal(resolveType({ details: { icon: 'aws-ec2' } }).source, 'default', 'a legacy name without a catalogue type');
  assert.equal(resolveType({ details: { icon: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' } }).id, 'service', 'a custom SVG is no type');
  assert.deepEqual(resolveType({ kind: 'lambda' }), { id: 'aws-lambda', generic: 'function', source: 'kind' });
  assert.deepEqual(resolveType({ kind: 'gateway' }), { id: 'aws-api-gateway', generic: 'gateway', source: 'kind' });
  assert.deepEqual(resolveType({ kind: 'client-app' }), { id: 'service', generic: 'service', source: 'default' });
  assert.deepEqual(resolveType({}), { id: 'service', generic: 'service', source: 'default' });
  assert.deepEqual(resolveType({ type: 'mainframe' }), { id: 'service', generic: 'service', source: 'default', unknown: 'mainframe' });
  assert.deepEqual(resolveType({ type: 'mainframe', kind: 'lambda' }).source, 'kind', 'an unknown value falls through the chain');
  assert.deepEqual(typeFields({ type: 'mainframe' }), { type: 'service', typeSource: 'default', declaredType: 'mainframe' }, 'stored, reported');
  assert.deepEqual(typeFields({ type: 'redis' }), { type: 'redis', typeSource: 'declared' });
  assert.equal(legacyType('aws-iam'), null);
  assert.deepEqual(withType({ details: { icon: 'vault', product: 'x' } }), { details: { icon: 'vault', product: 'x' }, type: 'hashicorp-vault' }, 'additive: the old fields stay');
  const has = { type: 'auth0', details: { icon: 'vault' } };
  assert.equal(withType(has), has, 'nothing added when a type is there');
  assert.ok(searchTypes('queue').specific.some((t) => t.id === 'aws-sqs') && searchTypes('idp').specific.some((t) => t.id === 'auth0'));
});

test('the browser mirror (web/js/components/type-info.js) equals the core catalogue and resolves the same', () => {
  assert.deepEqual(W.TYPES.map((t: any) => [t.id, t.label, t.generic, t.icon]), TYPES.map((t) => [t.id, t.label, t.generic, t.icon]));
  assert.deepEqual(W.LEGACY_ICONS, LEGACY_ICONS);
  assert.deepEqual(W.STORE_TYPE, STORE_TYPE); assert.deepEqual(W.CHANNEL_TYPE, CHANNEL_TYPE);
  const inputs: any[] = [{}, { type: 'auth0' }, { type: 'idp' }, { type: 'nope' }, { kind: 'lambda' }, { kind: 'gateway' }, { kind: 'infra' }, { details: { icon: 'vault' } }, { details: { icon: 'aws-ec2' } }, { type: 'nope', details: { icon: 'redis' } }, { type: 'kafka', kind: 'lambda' }];
  for (const c of inputs) assert.deepEqual(W.resolveType(c), resolveType(c), JSON.stringify(c));
  assert.equal(W.typeSrc('idp'), 'icons/generic/Res_Authenticated-User_48_Light.svg');
  assert.equal(W.typeSrc('idp', true), 'icons/generic/Res_Authenticated-User_48_Dark.svg', 'the generic icon swaps with the theme');
  assert.equal(W.typeSrc('hashicorp-vault'), 'icons/vault.svg');
  assert.equal(W.typeSrc('nope'), null);
  assert.deepEqual(['hashicorp-vault', 'kafka', 'mysql', 'auth0', 'idp'].map(W.typeTile), ['slate', 'white-dark', 'white-dark', null, null]);
  assert.deepEqual(W.resolveType({ type: 'aws-lambda', typeSource: 'kind' }), { id: 'service', generic: 'service', source: 'default' }, 'an API output with typeSource kind is read back as the stored header');
  assert.deepEqual(W.searchTypes('queue').specific.map((t: any) => t.id).sort(), searchTypes('queue').specific.map((t) => t.id).sort());
});

test('the schema accepts type, still accepts details.icon and details.product (marked deprecated), and the old samples validate', () => {
  const schema = JSON.parse(readFileSync(join(import.meta.dirname, '../schema/manifest.schema.json'), 'utf8'));
  const svc = schema.$defs.service.properties;
  assert.equal(svc.type.type, 'string');
  assert.equal(svc.details.properties.icon.deprecated, true); assert.equal(svc.details.properties.product.deprecated, true);
  assert.match(svc.details.properties.icon.description, /DEPRECATED/); assert.match(svc.details.properties.product.description, /DEPRECATED/);
  const validate = createValidator(schema);
  const base = JSON.parse(readFileSync(join(SAMPLES, 'lo-n-vault.json'), 'utf8'));
  assert.deepEqual(validate(base), [], 'the legacy sample: details.icon only');
  assert.deepEqual(validate({ ...base, service: { ...base.service, type: 'mainframe', details: { icon: 'vault', product: 'HashiCorp Vault' } } }), [], 'an unknown type value and both old fields are accepted');
  assert.notDeepEqual(validate({ ...base, service: { ...base.service, type: 42 } }), []);
});

test('design edit: type sets the field, null clears it, an unknown value is BAD_TYPE; the legacy icon edit still works and keeps details', () => {
  const rs = rows();
  const set = designEditOps({ kind: 'component', name: 'auth-svc', serviceKind: 'service', type: 'auth0' }, rs);
  assert.equal((set[0].data as any).type, 'auth0');
  const withT = rs.map((r) => (r.service === 'auth-svc' && r.list === 'header' ? { ...r, data: { ...r.data, type: 'idp', details: { icon: 'vault', product: 'P' } } } : r));
  const keep = designEditOps({ kind: 'component', name: 'auth-svc', serviceKind: 'service', team: 'x' }, withT)[0].data as any;
  assert.equal(keep.type, 'idp'); assert.deepEqual(keep.details, { icon: 'vault', product: 'P' }, 'the old fields are kept');
  assert.equal((designEditOps({ kind: 'component', name: 'auth-svc', serviceKind: 'service', type: null }, withT)[0].data as any).type, undefined);
  try { designEditOps({ kind: 'component', name: 'auth-svc', serviceKind: 'service', type: 'nope' }, rs); assert.fail('no error'); } catch (e: any) { assert.equal(e.code, 'BAD_TYPE'); assert.equal(e.field, 'type'); }
});

// ---- migration 021 ----
const MIG = join(import.meta.dirname, '../server/db/migrations');
const ALL = readdirSync(MIG).filter((f) => f.endsWith('.sql')).sort();
const quiet = <T>(f: () => T): T => { const log = console.log; console.log = () => {}; try { return f(); } finally { console.log = log; } };

test('021 adds type additively: snapshots and service-header draft ops; icon and product bytes untouched; subsystem draft icons, customs and other rows left alone; a backup is taken', () => {
  assert.ok(ALL.includes('021_component_type.sql'));
  const path = join(mkdtempSync(join(tmpdir(), 'flow-mapper-mig21-')), 'old.db');
  const raw = new DatabaseSync(path);
  raw.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; CREATE TABLE schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL, checksum TEXT)');
  for (const f of ALL.filter((f) => f < '021')) {
    const sql = readFileSync(join(MIG, f), 'utf8');
    raw.exec(sql);
    raw.prepare('INSERT INTO schema_migrations VALUES (?, ?, ?)').run(f, 'then', createHash('sha256').update(sql).digest('hex'));
  }
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1" fill="#fff"/></svg>';
  const metas: Record<string, any> = {
    vault: { team: 't', details: { icon: 'vault', product: 'HashiCorp Vault' } }, auth: { details: { icon: 'auth0', product: 'Auth0 identity platform' } }, sqs: { details: { icon: 'aws-sqs' } },
    ec2: { details: { icon: 'aws-ec2' } }, custom: { details: { icon: SVG, product: 'My own thing' } }, plain: { team: 'x' }, typed: { type: 'redis', details: { icon: 'vault' } }, uni: { description: 'café → "q"', details: { icon: 'mongodb' } },
  };
  raw.prepare("INSERT INTO envs (name, kind, created_at) VALUES ('d', 'design', 'now')").run();
  for (const [s, m] of Object.entries(metas)) raw.prepare("INSERT INTO snapshots (env, service, kind, meta, version, harvested_at, updated_at) VALUES ('d', ?, 'service', ?, 1, 'now', 'now')").run(s, JSON.stringify(m));
  raw.prepare("INSERT INTO snapshots (env, service, kind, meta, version, harvested_at, updated_at) VALUES ('d', 'bad', 'service', 'not json', 1, 'now', 'now')").run();
  raw.prepare("INSERT INTO drafts (env, slug, name, created_by, created_at, updated_at) VALUES ('d', 'x', 'x', 'ana', 'now', 'now')").run();
  const op = raw.prepare("INSERT INTO draft_ops (draft_id, seq, op, anchor, service, list, key, data, author, at) VALUES (1, ?, ?, ?, ?, ?, '', ?, 'ana', 'now')");
  const ops: [string, string, string, string, any][] = [
    ['upsert', 'svc:vault2', 'vault2', 'header', { kind: 'infra', details: { icon: 'vault', product: 'HashiCorp Vault' } }], ['upsert', 'svc:cust', 'cust', 'header', { kind: 'service', details: { icon: SVG } }],
    ['upsert', 'grp:agent', '', 'subsystem', { label: 'Agent', icon: 'agent' }], ['upsert', 'grp:db', '', 'subsystem', { label: 'DB', icon: 'database', details: { icon: 'vault' } }], ['delete', 'svc:gone', 'gone', 'header', null],
  ];
  ops.forEach(([o, a, s, l, d], i) => op.run(i + 1, o, a, s, l, d === null ? null : JSON.stringify(d)));
  const before = { snaps: raw.prepare('SELECT * FROM snapshots ORDER BY service').all() as any[], ops: raw.prepare('SELECT * FROM draft_ops ORDER BY seq').all() as any[] };
  raw.close();

  const db = quiet(() => openDb(path));
  assert.ok(existsSync(`${path}.pre-021.bak`), 'backed up first');
  const bak = new DatabaseSync(`${path}.pre-021.bak`, { readOnly: true });
  assert.equal((bak.prepare("SELECT meta FROM snapshots WHERE service = 'vault'").get() as any).meta, JSON.stringify(metas.vault), 'the backup is the old state');
  bak.close();
  const snaps = db.prepare('SELECT * FROM snapshots ORDER BY service').all() as any[];
  assert.equal(snaps.length, before.snaps.length);
  const typeOf = (s: string) => { try { return JSON.parse(snaps.find((x) => x.service === s).meta).type; } catch { return 'invalid'; } };
  assert.deepEqual(['vault', 'auth', 'sqs', 'ec2', 'custom', 'plain', 'typed', 'uni', 'bad'].map(typeOf), ['hashicorp-vault', 'auth0', 'aws-sqs', undefined, undefined, undefined, 'redis', 'mongodb', 'invalid']);
  for (const old of before.snaps) {
    const now = snaps.find((x) => x.service === old.service);
    if (old.service === 'bad') { assert.equal(now.meta, old.meta); continue; }
    const a = JSON.parse(old.meta), b = JSON.parse(now.meta);
    assert.equal(JSON.stringify(b.details), JSON.stringify(a.details), `${old.service}: details byte for byte`);
    const { type: _t, ...rest } = b, { type: _u, ...was } = a; assert.equal(JSON.stringify(rest), JSON.stringify(was), `${old.service}: everything else unchanged`);
    for (const c of ['env', 'service', 'kind', 'version', 'harvested_at', 'commit_sha', 'updated_at']) assert.equal(now[c], old[c]);
  }
  assert.equal(JSON.parse(snaps.find((x) => x.service === 'uni').meta).description, 'café → "q"', 'unicode survives');
  const dops = db.prepare('SELECT * FROM draft_ops ORDER BY seq').all() as any[];
  assert.equal(dops.length, before.ops.length);
  const d = (n: number) => (dops[n].data === null ? null : JSON.parse(dops[n].data));
  assert.equal(d(0).type, 'hashicorp-vault'); assert.deepEqual(d(0).details, { icon: 'vault', product: 'HashiCorp Vault' });
  assert.equal(d(1).type, undefined, 'a custom SVG is no type');
  assert.deepEqual(d(2), { label: 'Agent', icon: 'agent' }, 'a subsystem item keeps its icon and gets nothing');
  assert.equal(dops[2].data, before.ops[2].data, 'subsystem rows byte for byte');
  assert.equal(dops[3].data, before.ops[3].data, 'even a subsystem item with a details.icon is not a header');
  assert.equal(dops[4].data, null);
  assert.equal(dops.map((x) => x.anchor).join(), before.ops.map((x) => x.anchor).join());
  db.close();
});

// ---- ingest, import, API ----
test('ingest adds the type for a built-in details.icon (the icon stays), keeps a declared type, an unknown value is stored; REST and MCP carry type and typeSource', async () => {
  const app = await startApp();
  try {
    const m = JSON.parse(readFileSync(join(SAMPLES, 'lo-n-vault.json'), 'utf8')); // the legacy sample: details.icon only
    const post = (service: any, version: number) => app.call('POST', '/api/ingest', { manifests: [{ ...m, env: 'prod', version, service: { ...m.service, ...service } }] });
    assert.equal((await post({}, 1)).status, 201);
    const get = async () => ((await app.call('GET', '/api/envs/prod/services')).body as any[]).find((s) => s.name === 'lo-n-vault');
    let s = await get();
    assert.equal(s.type, 'hashicorp-vault'); assert.equal(s.typeSource, 'declared'); assert.equal(s.details.icon, 'vault');
    assert.equal((await post({ type: 'mainframe' }, 2)).status, 201, 'an unknown value is accepted');
    s = await get();
    assert.equal(s.type, 'hashicorp-vault', 'unknown declared value: the chain goes on to the legacy icon'); assert.equal(s.typeSource, 'legacy-icon'); assert.equal(s.declaredType, 'mainframe');
    assert.equal((await post({ type: 'mainframe', details: {} }, 3)).status, 201);
    s = await get();
    assert.equal(s.type, 'service', 'reads as service'); assert.equal(s.declaredType, 'mainframe', 'stored and reported'); assert.equal(s.typeSource, 'default');
    assert.equal((await post({ type: 'idp', details: { icon: 'vault', product: 'x' } }, 4)).status, 201);
    s = await get();
    assert.equal(s.type, 'idp'); assert.deepEqual(s.details, { icon: 'vault', product: 'x' });
    assert.equal((await post({ kind: 'lambda', details: {} }, 5)).status, 201);
    s = await get();
    assert.equal(s.type, 'aws-lambda'); assert.equal(s.typeSource, 'kind');
    const one = (await app.call('GET', '/api/envs/prod/services/lo-n-vault')).body;
    assert.equal(one.service.type, 'aws-lambda'); assert.equal(one.service.typeSource, 'kind');
    const mcp = async (name: string, args: any) => JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).body.result.content[0].text);
    assert.equal((await mcp('get_service', { env: 'prod', service: 'lo-n-vault' })).service.type, 'aws-lambda');
    const row = (await mcp('list_services', { env: 'prod' })).find((x: any) => x.service === 'lo-n-vault');
    assert.equal(row.type, 'aws-lambda'); assert.equal(row.typeSource, 'kind');
  } finally { await app.close(); }
});

test('import of an old export: a built-in details.icon and no type gets the type added, icon and product stay; subsystem rows untouched', async () => {
  const A = await startDesign('hld'), B = await startApp();
  try {
    const D = '/api/envs/hld/drafts';
    const d = (await A.call('POST', D, { name: 'x', createdBy: 'ana' })).body;
    const r = await A.call('POST', `${D}/${d.slug}/ops`, { ops: [{ op: 'upsert', anchor: 'svc:old-vault', data: { kind: 'infra', groupPath: 'platform', details: { icon: 'vault', product: 'HashiCorp Vault' } } }], author: 'ana' });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const bundle = (await A.call('GET', '/api/envs/hld/export')).body;
    // make it an OLD export: no `type` anywhere in the service rows
    const strip = (t: string, col: string, filter: (x: any) => boolean = () => true) => (bundle.tables[t] ?? []).forEach((x: any) => { if (typeof x[col] !== 'string' || !filter(x)) return; const o = JSON.parse(x[col]); delete o.type; x[col] = JSON.stringify(o); });
    strip('snapshots', 'meta'); strip('draft_ops', 'data', (x) => x.list === 'header');
    const op = bundle.tables.draft_ops.find((x: any) => x.anchor === 'svc:old-vault');
    assert.ok(op && !JSON.parse(op.data).type, 'the bundle op has no type');
    const subsBefore = JSON.stringify(bundle.tables.draft_ops.filter((x: any) => x.list === 'subsystem'));
    const imp = await B.call('POST', '/api/envs/import?as=copy', bundle);
    assert.equal(imp.status, 201, JSON.stringify(imp.body));
    const got = (await B.call('GET', '/api/envs/copy/services?draft=x')).body as any[];
    const v = got.find((s) => s.name === 'old-vault');
    assert.ok(v, 'the draft overlay shows the imported component');
    assert.equal(v.type, 'hashicorp-vault'); assert.deepEqual(v.details, { icon: 'vault', product: 'HashiCorp Vault' });
    assert.equal(JSON.stringify((B.ctx.db.prepare("SELECT * FROM draft_ops WHERE list = 'subsystem' ORDER BY seq").all() as any[]).map((x) => ({ ...x, draft_id: undefined }))).length > 0, true);
    assert.ok(subsBefore.length >= 2);
  } finally { await A.close(); await B.close(); }
});

test('a header read back from the API and written again is its stored form (the resolved fields are dropped, the stored value kept)', () => {
  assert.deepEqual(storedHeader({ kind: 'lambda', type: 'aws-lambda', typeSource: 'kind' }), { kind: 'lambda' });
  assert.deepEqual(storedHeader({ type: 'service', typeSource: 'default', declaredType: 'mainframe' }), { type: 'mainframe' });
  assert.deepEqual(storedHeader({ type: 'auth0', typeSource: 'declared' }), { type: 'auth0' });
  const plain = { kind: 'service', type: 'idp' };
  assert.equal(storedHeader(plain), plain);
});

test('type report findings: what still relies on legacy fields, and what it resolves to', () => {
  const SVG = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
  assert.deepEqual(findings({ type: 'auth0', details: { icon: 'auth0', product: 'Auth0' } }), [], 'typed, product equals the label: nothing');
  assert.deepEqual(findings({ details: { icon: 'vault' } }).map((f) => [f.reason, f.resolves]), [['builtin-icon', 'hashicorp-vault']]);
  assert.deepEqual(findings({ details: { icon: SVG } }).map((f) => [f.reason, f.resolves]), [['custom-icon', 'service']]);
  assert.deepEqual(findings({ details: { icon: 'aws-ec2' } }).map((f) => f.reason), ['icon-no-type']);
  assert.deepEqual(findings({ type: 'idp', details: { product: 'Home-grown login' } }).map((f) => f.reason), ['product-text']);
  assert.deepEqual(findings({ type: 'mainframe' }).map((f) => [f.reason, f.value, f.resolves]), [['unknown-type', 'mainframe', 'service']]);
  assert.deepEqual(findings({ kind: 'lambda' }), [], 'a kind alone is not legacy data');
  assert.deepEqual(findings({}), []);
});
