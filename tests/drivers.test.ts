// Drivers view (#130): the pure aggregation (store type → package → version, baseline, lag, mixed
// majors), the filter, the verdict, and the new client row fields (ops, candidates, plain) over the samples.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { sampleManifests, startApp } from './helpers.ts';
import type { ClientRow } from '../core/clients.ts';
import { baselinesOf, driverEntries, driverTable, entryPasses, lagLevel, lagOf, unresolvedItems, unresolvedPasses, componentsPerKind, chooseStore } from '../core/drivers.ts';
import { driversModel, driversCsv, driversReport } from '../core/drivers-export.ts';
import { parseDriverQuery } from '../core/versions.ts';
import { verdictOf, verdictText } from '../core/driver-verdict.ts';

const OPS = { read: 1, write: 1, total: 2 };
let n = 0;
/** A client row: `own` and `lib` as 'pkg version' strings; `libName` names the wrapper. */
function row(service: string, kind: string, own?: string, lib?: string, extra: Partial<ClientRow> = {}): ClientRow {
  const d = (s?: string) => (s ? { package: s.split(' ')[0], version: s.split(' ')[1] } : null);
  const major = (x: { version?: string }) => /^[\^~v]*(\d+)/.exec(x.version ?? '')?.[1];
  const drivers = [own && { ...d(own)!, from: 'own' as const }, lib && { ...d(lib)!, from: 'lib' as const }].filter(Boolean).map((x: any) => ({ ...x, major: major(x) })) as any[];
  return {
    store: `${kind}:db/r${n}`, kind, service, entity: 'resource', id: `r${n++}`, driver: d(own), lib: lib ? { package: 'wrap', version: '2.1.0', kind: 'in_house', driver: d(lib) } : null,
    drivers, via: [], mixed: [], unresolved: [], reasons: {}, candidates: {}, plain: {}, ops: OPS, ...extra,
  } as ClientRow;
}
const rows = [
  row('auth', 'redis', 'ioredis 5.3.2'), row('orders', 'redis', 'ioredis 5.3.2'), row('orders', 'redis', 'ioredis ^5.3.2'),
  row('inv', 'redis', 'ioredis 4.28.5'), row('cat', 'redis', undefined, 'ioredis 4.27.6'),
  row('ship', 'redis', 'ioredis 5.3.2', 'ioredis 4.27.6'),
  row('rep', 'redis', 'redis 4.6.13'), row('legacy', 'redis', 'redis 3.1.2'),
  row('inv', 'mongodb', 'mongoose 5.13.20'), row('cat', 'mongodb', 'mongoose 8.1.5'), row('tag', 'redis', 'ioredis latest'),
];

test('entries carry a clean version and drop drivers without a major', () => {
  const e = driverEntries(rows);
  assert.ok(!e.some((x) => x.version === 'latest'), 'a tag is not a version row');
  assert.deepEqual([...new Set(e.filter((x) => x.package === 'ioredis').map((x) => x.version))].sort(), ['4.27.6', '4.28.5', '5.3.2'], '^5.3.2 and 5.3.2 are one version');
  assert.equal(e.find((x) => x.service === 'cat' && x.kind === 'redis')!.lib!.package, 'wrap');
});

test('baseline is the newest major in use per store type and package; lag counts majors behind', () => {
  const e = driverEntries(rows), base = baselinesOf(e);
  assert.equal(base.get('redis|ioredis'), 5);
  assert.equal(base.get('redis|redis'), 4);
  assert.equal(base.get('mongodb|mongoose'), 8, 'another store type does not move it');
  const lag = (s: string, v: string) => lagOf(e.find((x) => x.service === s && x.version === v)!, base);
  assert.deepEqual([lag('auth', '5.3.2'), lag('inv', '4.28.5'), lag('legacy', '3.1.2'), lag('inv', '5.13.20')], [0, 1, 1, 3]);
  assert.deepEqual([0, 1, 2, 3].map(lagLevel), [0, 1, 2, 2]);
});

test('the table groups package then version, newest first, with components, resources and operations', () => {
  const e = driverEntries(rows), t = driverTable(e, 'redis', baselinesOf(e));
  const io = t.packages.find((p) => p.package === 'ioredis')!;
  assert.deepEqual(io.versions.map((v) => v.version), ['5.3.2', '4.28.5', '4.27.6']);
  assert.deepEqual(io.majors, [5, 4]);
  const v5 = io.versions[0];
  assert.deepEqual(v5.components, [{ service: 'auth', resources: 1, mixed: false }, { service: 'orders', resources: 2, mixed: false }, { service: 'ship', resources: 1, mixed: true }]);
  assert.equal(v5.resources, 4);
  assert.deepEqual(v5.ops, { read: 4, write: 4, total: 8 });
  const lib = io.versions[2];
  assert.deepEqual(lib.via.map((x) => [x.lib, x.version, x.count]), [['wrap', '2.1.0', 2]], 'cat and ship reach 4.27.6 through the wrapper');
  assert.equal(lib.direct, 0);
  assert.equal(io.components, 5);
  assert.equal(t.packages[0].package, 'ioredis', 'the package with most components first');
});

test('a component carrying two majors of one package is mixed, everywhere it appears', () => {
  const e = driverEntries(rows);
  assert.deepEqual(e.filter((x) => x.service === 'ship').map((x) => x.mixed), [true, true]);
  assert.equal(e.find((x) => x.service === 'inv' && x.kind === 'mongodb')!.mixed, false);
});

test('a query narrows the entries, never the baseline', () => {
  const e = driverEntries(rows), base = baselinesOf(e), vocab = { packages: ['ioredis', 'redis', 'mongoose'], components: ['auth', 'inv'] };
  const f = (q: string, mixedOnly = false) => driverTable(e.filter((x) => entryPasses(x, { query: parseDriverQuery(q, vocab), mixedOnly })), 'redis', base);
  assert.deepEqual(f('redis 3').packages.map((p) => [p.package, p.versions.map((v) => v.version)]), [['redis', ['3.1.2']]]);
  assert.equal(f('redis 3').packages[0].versions[0].lag, 1, 'still 1 major behind the whole env');
  assert.deepEqual(f('ioredis < 5').packages[0].versions.map((v) => v.version), ['4.28.5', '4.27.6']);
  assert.deepEqual(f('>= 4 < 5').packages.flatMap((p) => p.versions.map((v) => v.version)).sort(), ['4.27.6', '4.28.5', '4.6.13']);
  assert.deepEqual(f('auth').packages[0].versions.map((v) => v.version), ['5.3.2']);
  assert.deepEqual(f('', true).packages[0].versions.flatMap((v) => v.components.map((c) => c.service)), ['ship', 'ship']);
});

test('unresolved entries: from gaps with candidates, and from a version with no major; filtered by component and package only', () => {
  const gap = row('mongo-svc', 'mongodb', undefined, undefined, { unresolved: ['driver.package'], reasons: { 'driver.package': 'ambiguous_client_path' }, candidates: { 'driver.package': ['p81-mongo-client', 'saferx-dbapi'] }, plain: { 'driver.package': 'Both wrappers.' } });
  const u = unresolvedItems([...rows, gap]);
  const g = u.find((x) => x.service === 'mongo-svc')!;
  assert.deepEqual([g.field, g.reason, g.candidates, g.plain], ['driver.package', 'ambiguous_client_path', ['p81-mongo-client', 'saferx-dbapi'], 'Both wrappers.']);
  assert.deepEqual(u.filter((x) => x.service === 'tag').map((x) => [x.field, x.reason]), [['driver.version', 'no_major_in_version']]);
  const vocab = { packages: ['mongoose', 'p81-mongo-client'], components: [] };
  const pass = (q: string) => u.filter((x) => unresolvedPasses(x, { query: parseDriverQuery(q, vocab), mixedOnly: false })).map((x) => x.service);
  assert.ok(pass('mongoose < 6').every((s) => s !== 'mongo-svc'), 'neither candidate is mongoose');
  assert.ok(pass('p81-mongo-client').includes('mongo-svc'), 'a candidate keeps it in');
  assert.equal(componentsPerKind(driverEntries(rows), u).get('redis'), 8);
});

test('the verdict says what runs, what is behind, and what is unresolved', () => {
  const e = driverEntries(rows), base = baselinesOf(e);
  const t = driverTable(e, 'redis', base);
  const v = verdictText(verdictOf('Redis', '', t, 1, 0));
  assert.match(v, /^Redis: 2 packages, 5 versions, 7 components\. ioredis runs on two majors \(5 and 4\), redis on two \(4 and 3\)\./);
  assert.match(v, /1 entry is unresolved/);
  const q = driverTable(e.filter((x) => entryPasses(x, { query: parseDriverQuery('redis 3', { packages: ['redis'], components: [] }), mixedOnly: false })), 'redis', base);
  assert.match(verdictText(verdictOf('Redis', 'redis 3', q, 0, 2)), /^redis 3 in Redis: 1 component on 1 version \(3\.1\.2\)\. It is 1 major behind 4\.x, the newest in use\. 2 unresolved entries could be a different driver/);
  assert.match(verdictText(verdictOf('Redis', 'redis 9', driverTable([], 'redis', base), 0, 0)), /No match for redis 9 in Redis/);
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
});
after(() => app.close());

test('client rows over the samples carry operations, candidates and plain; Redis and Mongo have the demo cases', async () => {
  const all = (await app.call('GET', '/api/envs/prod/clients')).body.rows as ClientRow[];
  const orders = all.find((r) => r.service === 'orders-svc' && r.kind === 'redis')!;
  assert.ok(orders.ops.total > 0 && orders.ops.read + orders.ops.write >= orders.ops.total, 'steps on the resource, read-write counted in both');
  const cat = all.find((r) => r.service === 'catalog-svc' && r.kind === 'redis')!;
  assert.deepEqual(cat.candidates['driver.version'], ['ioredis']);
  assert.match(cat.plain['driver.version'], /lockfile/);
  const ship = all.find((r) => r.service === 'shipping-svc' && r.kind === 'mongodb')!;
  assert.equal(ship.driver, null, 'a client with no driver still yields a row');
  assert.deepEqual(ship.candidates['driver.package'], ['p81-mongo-client', 'saferx-dbapi']);
  const e = driverEntries(all), base = baselinesOf(e);
  const mongo = driverTable(e, 'mongodb', base);
  assert.deepEqual(mongo.packages.map((p) => p.package).sort(), ['mongodb', 'mongoose', 'typeorm'], 'the ORMs are drivers of their own, and the mongodb driver inside them is listed too');
  assert.ok(driverTable(e, 'redis', base).packages.find((p) => p.package === 'ioredis')!.majors.length >= 2);
  assert.ok(e.some((x) => x.lib?.package === 'saferxlib'), 'the wrapper case');
});

test('chooseStore opens the requested type with data, else the one with most components', () => {
  const order = ['redis', 'mongodb', 'sqs-sns', 'http'];
  const only = new Map([['redis', 2]]);
  assert.deepEqual(chooseStore('mongodb', only, order), { store: 'redis', from: 'mongodb' });
  assert.deepEqual(chooseStore('redis', only, order), { store: 'redis', from: null });
  assert.deepEqual(chooseStore('mongodb', new Map([['redis', 2], ['mongodb', 5]]), order), { store: 'mongodb', from: null });
  assert.deepEqual(chooseStore('http', new Map([['redis', 2], ['mongodb', 5]]), order), { store: 'mongodb', from: 'http' });
  assert.deepEqual(chooseStore('mongodb', new Map(), order), { store: 'mongodb', from: null });
  assert.deepEqual(chooseStore(null, new Map([['mongodb', 1]]), order), { store: 'mongodb', from: null });
  assert.deepEqual(chooseStore(null, new Map(), order), { store: 'redis', from: null });
});

const O = { env: 'prod', store: 'all', date: '2026-11-17', version: '0.62.0', link: '#/inventory?tab=drivers' };
/** A tiny CSV reader for the tests (quotes, doubled quotes, CRLF). */
const parseCsv = (t: string) => { const out: string[][] = []; let row: string[] = [], c = '', q = false; for (let i = 0; i < t.length; i++) { const ch = t[i]; if (q) { if (ch === '"') { if (t[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; } else if (ch === '"') q = true; else if (ch === ',') { row.push(c); c = ''; } else if (ch === '\r') { /* skip */ } else if (ch === '\n') { row.push(c); out.push(row); row = []; c = ''; } else c += ch; } return out; };

test('driversCsv: one row per component x package x version, lag blank on the newest, unresolved as rows, quoted', () => {
  const m = driversModel([...rows, row('weird', 'redis', undefined, undefined, { unresolved: ['driver.package'], reasons: { 'driver.package': 'ambiguous, "two"' }, candidates: { 'driver.package': ['a', 'b'] } })]);
  const t = parseCsv(driversCsv(m, { ...O, store: 'redis' }));
  assert.deepEqual(t[0].slice(0, 16), ['env', 'store type', 'package', 'version', 'major', 'lag', 'newest major in env', 'component', 'resources', 'ops read', 'ops write', 'ops total', 'via', 'status', 'candidates', 'reason']);
  const find = (svc: string, ver: string) => t.find((r) => r[7] === svc && r[3] === ver)!;
  assert.deepEqual([find('auth', '5.3.2')[5], find('auth', '5.3.2')[6], find('auth', '5.3.2')[12]], ['', '5', 'direct']);
  assert.equal(find('inv', '4.28.5')[5], '1');
  assert.equal(find('orders', '5.3.2')[8], '2', 'two resources of one component on one version are one row');
  assert.equal(find('cat', '4.27.6')[12], 'wrap@2.1.0');
  const u = t.find((r) => r[13] === 'unresolved' && r[7] === 'weird')!;
  assert.deepEqual([u[7], u[14], u[15]], ['weird', 'a; b', 'ambiguous, "two"']);
  assert.ok(!t.some((r) => r[1] === 'MongoDB'), 'only the chosen store type');
  assert.match(t[1][16], /^Redis$/, 'the filter is stated on each row');
});

test('driversCsv respects the query and mixed toggle', () => {
  const m = driversModel(rows);
  const q = parseCsv(driversCsv(m, { ...O, store: 'redis', q: 'redis 3' })).slice(1).filter((r) => r.length > 1);
  assert.deepEqual(q.map((r) => [r[2], r[3], r[7]]), [['redis', '3.1.2', 'legacy']]);
  assert.match(q[0][16], /query "redis 3\.x"/);
  const mx = parseCsv(driversCsv(m, { ...O, store: 'redis', mixed: true })).slice(1).filter((r) => r.length > 1);
  assert.ok(mx.length && mx.every((r) => r[7] === 'ship'));
  assert.ok(parseCsv(driversCsv(m, O)).some((r) => r[1] === 'MongoDB'), 'all store types');
});

test('driversReport: title, scope, verdict, a table per package, mixed majors, unresolved, footer', () => {
  const md = driversReport(driversModel(rows), { ...O, store: 'redis' });
  assert.match(md, /^# Drivers report · prod · 2026-11-17\n/);
  assert.match(md, /Scope: environment `prod` · Redis\./);
  assert.match(md, /Redis: \d+ packages?, /);
  assert.match(md, /### ioredis\n[\s\S]*\| Version \| Lag \| Components \| Resources \| Ops/);
  assert.match(md, /\| 4\.28\.5 \| 1 major behind \|/);
  assert.match(md, /## Mixed majors\n\n- ship · Redis · ioredis: majors 5 and 4/);
  assert.match(md, /## Unresolved\n\n(None in this scope|\| Component)/);
  assert.match(md, /Generated by Flow-Mapper 0\.62\.0 on 2026-11-17\..* View: #\/inventory\?tab=drivers/);
  assert.match(driversReport(driversModel(rows), { ...O, store: 'redis', q: 'redis 3' }), /query "redis 3\.x"/);
});

test('GET /clients/drivers.csv and .md serve the same files with a download name', async () => {
  const csv = await fetch(`${app.base}/api/envs/prod/clients/drivers.csv?store=mongodb&q=mongoose%20%3C%206`);
  assert.equal(csv.status, 200);
  assert.match(csv.headers.get('content-type')!, /text\/csv/);
  assert.match(csv.headers.get('content-disposition')!, /filename="drivers-prod-mongodb-\d{8}\.csv"/);
  const t = parseCsv(await csv.text()).slice(1).filter((r) => r.length > 1);
  assert.ok(t.length && t.every((r) => r[1] === 'MongoDB'));
  const md = await (await fetch(`${app.base}/api/envs/prod/clients/drivers.md`)).text();
  assert.match(md, /^# Drivers report · prod · /);
  assert.match(md, /## Redis/);
});
