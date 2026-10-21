// Importing one level (core/import-level.ts), on the real samples (prod -> the demo design sase-hld with its draft hld-import, and a
// blank design) and on small hand-made rows for the cases the samples do not have (a self-call through a queue, new-reference stubs).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { SAMPLES, readSample, sampleManifests, startApp } from './helpers.ts';
import { seedEnvRecipes } from '../scripts/seed-envs.ts';
import { buildIndex } from '../core/graph-index.ts';
import { rowsToModel, type ItemRow } from '../core/item-rows.ts';
import { importSet, ImportError, type ImportInput } from '../core/import-level.ts';
import { importOps, previewOf } from '../core/import-preview.ts';
import { originsOf, referencesOf } from '../core/references.ts';
import { draftView } from '../server/store/drafts.ts';
import { envItemRows } from '../server/store/item-rows.ts';

let app: Awaited<ReturnType<typeof startApp>>, prod: ItemRow[], versions: Map<string, number>;
before(async () => {
  app = await startApp();
  assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201);
  const { env, dtos } = readSample('dtos/prod.json');
  assert.equal((await app.call('POST', `/api/envs/${env}/dtos`, { dtos })).status, 201);
  const sc = readSample('schemas/prod.json');
  assert.equal((await app.call('POST', `/api/envs/${sc.env}/schemas`, { schemas: sc.schemas })).status, 201);
  seedEnvRecipes(app.ctx, join(SAMPLES, 'envs'));
  prod = envItemRows(app.ctx.db, 'prod');
  versions = new Map(prod.filter((r) => r.list === 'header').map((r) => [r.service, r.data.version]));
});
after(() => app.close());

const input = (anchor: string, here: ItemRow[], extra: Partial<ImportInput> = {}): ImportInput => ({
  source: 'prod', anchor, srcRows: prod, srcGraph: app.ctx.view('prod').g, srcVersions: versions, here, groups: ['agent', 'network', 'platform'], infraOwner: 'prod-infra', ...extra,
});
const anchors = (set: ReturnType<typeof importSet>, why?: string) => set.items.filter((i) => !why || i.why === why).map((i) => `${i.why}:${i.row.list}:${i.row.service}/${i.row.key}`);

test('an endpoint of the demo design (a reference): its handler and the function it calls come along; what the design has stays; the callee stays a reference', () => {
  const here = draftView(app.ctx.db, 'sase-hld', 'hld-import').rows;
  const set = importSet(input('ing:users-svc/in.getPosture', here));
  assert.deepEqual(anchors(set), ['handler:functions:users-svc/get_posture', 'inside:functions:users-svc/load_devices']);
  assert.ok(set.items.every((i) => i.origin.env === 'prod' && i.origin.version === versions.get('users-svc')));
  const already = new Map(set.alreadyHere.map((a) => [a.anchor, a.differs]));
  for (const a of ['res:users-svc/cache', 'res:users-svc/usersDb', 'egr:users-svc/out.auth.verify', 'ing:users-svc/in.getPosture', 'dto:users-svc/response/-/in.getPosture']) assert.equal(already.get(a), false, a);
  assert.deepEqual(set.references, [{ service: 'auth-svc', ingress: 'in.verify', bindKey: 'http:POST auth-svc/verify', label: 'http:POST auth-svc/verify', state: 'reference' }]);
  assert.ok(!set.items.some((i) => i.row.service === 'auth-svc'), 'never recursive: nothing of auth-svc comes along');
  const p = previewOf(set, 'ing:users-svc/in.getPosture', 'prod');
  assert.deepEqual([p.total, p.counts.functions, p.summary.handler, p.summary.inside], [2, 2, 'get_posture', 1]);
  assert.deepEqual(p.summary.stores.map((s) => s.key), ['redis:cache-main/user:{id}', 'postgres:users-db/users']);
});

test('into a blank design: header (subsystem of the source if the design has it), endpoint, DTO, functions, call, stores, schema; the callee is a stub reference', () => {
  const set = importSet(input('ing:users-svc/in.getPosture', []));
  assert.deepEqual(anchors(set).filter((a) => !a.includes('schema')), [
    'header:header:users-svc/', 'ingress:ingress:users-svc/in.getPosture', 'dto:dto:users-svc/in.getPosture|response|', 'handler:functions:users-svc/get_posture',
    'resource:resources:users-svc/cache', 'egress:egress:users-svc/out.auth.verify', 'inside:functions:users-svc/load_devices', 'resource:resources:users-svc/usersDb',
    'header:header:auth-svc/', 'reference:ingress:auth-svc/in.verify']);
  assert.ok(anchors(set).includes('schema:schema:/postgres:users-db/users|code'), 'the schema of a store the functions use');
  const head = set.items.find((i) => i.row.list === 'header' && i.row.service === 'users-svc')!;
  assert.equal(head.row.data.groupPath, undefined, 'users-svc has no subsystem in prod: none here');
  assert.deepEqual(head.row.data, { kind: 'service', team: 'identity', repo: 'github.com/acme/users-svc', language: 'python', description: 'User profiles' }, 'no version, harvestedAt, commit');
  assert.equal(set.references[0].state, 'new-reference');
  assert.ok(!set.items.some((i) => i.row.service === 'auth-svc' && i.row.list === 'functions'));
  const { ops, origins } = importOps(set);
  assert.equal(ops.length, set.items.length); assert.equal(origins.length, ops.length);
  assert.ok(ops.slice(0, 2).every((o) => o.anchor.startsWith('svc:')), 'headers first');
  const refs = referencesOf(set.items.map((i) => i.row), originsOf([], set.items.map((i) => ({ service: i.row.service, list: i.row.list, key: i.row.key, sourceEnv: 'prod', takenAt: 't' }))), null);
  assert.deepEqual(Object.keys(refs.endpoints), ['ing:auth-svc/in.verify'], 'what stays a reference is a reference once imported');
});

test('groupPath: the given one must be a subsystem of the design; the source\'s is kept when the design has it; \'\' means none', () => {
  const withGroup = prod.map((r) => (r.list === 'header' && r.service === 'users-svc' ? { ...r, data: { ...r.data, groupPath: 'platform' } } : r));
  const head = (set: ReturnType<typeof importSet>) => set.items.find((i) => i.row.list === 'header' && i.row.service === 'users-svc')!.row.data.groupPath;
  assert.equal(head(importSet(input('ing:users-svc/in.getPosture', [], { srcRows: withGroup }))), 'platform');
  assert.equal(head(importSet(input('ing:users-svc/in.getPosture', [], { srcRows: withGroup, groups: ['agent'] }))), undefined);
  assert.equal(head(importSet(input('ing:users-svc/in.getPosture', [], { srcRows: withGroup, groupPath: 'network' }))), 'network');
  assert.equal(head(importSet(input('ing:users-svc/in.getPosture', [], { srcRows: withGroup, groupPath: '' }))), undefined);
  assert.throws(() => importSet(input('ing:users-svc/in.getPosture', [], { groupPath: 'nope' })), (e: any) => e instanceof ImportError && e.code === 'NO_GROUP');
});

test('a component into a blank design: header, endpoints, calls, stores, DTOs, schemas; no functions; every endpoint then a reference', () => {
  const set = importSet(input('svc:users-svc', []));
  assert.equal(set.level, 'component');
  assert.ok(!set.items.some((i) => i.row.list === 'functions'));
  assert.deepEqual(set.items.filter((i) => i.row.list === 'ingress').map((i) => i.row.key).sort(), ['in.getContact', 'in.getPosture', 'in.getUser']);
  assert.ok(set.items.some((i) => i.row.list === 'egress') && set.items.some((i) => i.row.list === 'resources') && set.items.some((i) => i.row.list === 'dto'));
  assert.deepEqual(set.references, []);
  const rows = set.items.map((i) => i.row);
  const refs = referencesOf(rows, originsOf([], rows.map((r) => ({ service: r.service, list: r.list, key: r.key, sourceEnv: 'prod', takenAt: 't' }))), null);
  assert.deepEqual(refs.components['svc:users-svc'], { refs: 3, endpoints: 3 });
});

const hdr = (service: string, kind = 'service'): ItemRow => ({ service, list: 'header', key: '', data: { kind, version: 3 } });
const fn = (service: string, id: string, steps: any[] = []): ItemRow => ({ service, list: 'functions', key: id, data: { id, name: id, steps } });
const ing = (service: string, id: string, bindKey: string, handler: string, transport = 'http'): ItemRow => ({ service, list: 'ingress', key: id, data: { id, bindKey, transport, handler } });
const egr = (service: string, id: string, bindKey: string, transport = 'http'): ItemRow => ({ service, list: 'egress', key: id, data: { id, bindKey, transport, mode: transport === 'http' ? 'sync' : 'async' } });
const synth = (rows: ItemRow[], anchor: string, here: ItemRow[] = [], extra: Partial<ImportInput> = {}) => importSet({
  source: 'src', anchor, srcRows: rows, srcGraph: buildIndex(rowsToModel('src', rows)), srcVersions: new Map([['s', 3], ['o', 5], ['t', 7]]), here, groups: [], infraOwner: 'src-infra', ...extra });

test('an async call: its channel and bindings come along under the infra owner when their owner is not in the design; a consumer in another component is a stub', () => {
  const rows: ItemRow[] = [
    hdr('s'), fn('s', 'a', [{ seq: 1, type: 'egress', target: 'out.q' }]), ing('s', 'in.a', 'http:GET s/a', 'a'), egr('s', 'out.q', 'sns:topic', 'sns'),
    hdr('o', 'infra'), { service: 'o', list: 'channels', key: 'sns:topic', data: { bindKey: 'sns:topic', kind: 'sns-topic' } }, { service: 'o', list: 'channels', key: 'sqs:q', data: { bindKey: 'sqs:q', kind: 'sqs-queue' } },
    { service: 'o', list: 'bindings', key: 'sub1', data: { id: 'sub1', from: 'sns:topic', to: 'sqs:q' } },
    hdr('t'), ing('t', 'in.q', 'sqs:q', 'onq', 'sqs'), fn('t', 'onq'),
  ];
  const set = synth(rows, 'ing:s/in.a');
  assert.deepEqual(anchors(set), ['header:header:s/', 'ingress:ingress:s/in.a', 'handler:functions:s/a', 'egress:egress:s/out.q', 'owner:header:src-infra/', 'channel:channels:src-infra/sns:topic', 'channel:channels:src-infra/sqs:q', 'binding:bindings:src-infra/o.sub1', 'header:header:t/', 'reference:ingress:t/in.q']);
  assert.deepEqual(set.items.find((i) => i.row.list === 'bindings')!.row.data, { id: 'o.sub1', from: 'sns:topic', to: 'sqs:q' });
  assert.deepEqual(set.items.find((i) => i.row.list === 'header' && i.row.service === 'src-infra')!.row.data, { kind: 'infra', description: 'Channels and bindings imported from src.' });
  assert.deepEqual(set.items.filter((i) => i.row.service === 'src-infra').map((i) => i.origin.version), [null, null, null, null], 'infra rows have no source version');
  assert.deepEqual(set.items.find((i) => i.row.service === 's')!.origin, { env: 'src', version: 3 });
  assert.deepEqual(set.references.map((r) => [r.service, r.state]), [['t', 'new-reference']]);
  const had = synth(rows, 'ing:s/in.a', [hdr('o', 'infra'), { service: 'o', list: 'channels', key: 'sns:topic', data: {} }]);
  assert.ok(anchors(had).includes('channel:channels:o/sqs:q'), 'the owner is in the design: the channel keeps it');
  assert.ok(had.alreadyHere.some((a) => a.anchor === 'ch:sns:topic'), 'a channel the design already has (under any owner) is not imported again');
});

test('a self-call through a queue stays inside the component: the consumer endpoint and its closure come along', () => {
  const rows: ItemRow[] = [
    hdr('s'), fn('s', 'a', [{ seq: 1, type: 'egress', target: 'out.q' }]), ing('s', 'in.a', 'http:GET s/a', 'a'), egr('s', 'out.q', 'sqs:self', 'sqs'),
    { service: 's', list: 'channels', key: 'sqs:self', data: { bindKey: 'sqs:self', kind: 'sqs-queue' } },
    ing('s', 'in.self', 'sqs:self', 'b', 'sqs'), fn('s', 'b', [{ seq: 1, type: 'call', target: 'c' }]), fn('s', 'c'),
  ];
  const set = synth(rows, 'ing:s/in.a');
  assert.ok(anchors(set).includes('ingress:ingress:s/in.self') && anchors(set).includes('handler:functions:s/b') && anchors(set).includes('inside:functions:s/c'));
  assert.deepEqual(set.references, []);
});

test('designed / reference states of a callee in another component; errors', () => {
  const rows: ItemRow[] = [hdr('s'), fn('s', 'a', [{ seq: 1, type: 'egress', target: 'out.t' }]), ing('s', 'in.a', 'http:GET s/a', 'a'), egr('s', 'out.t', 'http:GET t/x'), hdr('t'), ing('t', 'in.x', 'http:GET t/x', 'x'), fn('t', 'x')];
  const state = (here: ItemRow[]) => synth(rows, 'ing:s/in.a', [hdr('s'), ...here]).references[0].state;
  assert.equal(state([hdr('t'), ing('t', 'in.x', 'http:GET t/x', 'x'), fn('t', 'x')]), 'designed');
  assert.equal(state([hdr('t'), ing('t', 'in.x', 'http:GET t/x', 'x')]), 'reference');
  assert.equal(state([]), 'new-reference');
  const code = (f: () => unknown) => { try { f(); } catch (e: any) { return e.code; } };
  assert.equal(code(() => synth(rows, 'ing:s/in.nope')), 'NO_ITEM');
  assert.equal(code(() => synth(rows, 'svc:nope')), 'NO_ITEM');
  for (const a of ['fn:s/a', 'egr:s/out.t', 'ch:x', 'dto:s/request/-/in.a#f', 'nonsense']) assert.equal(code(() => synth(rows, a)), 'BAD_ANCHOR', a);
  const set = synth(rows, 'ing:s/in.a');
  assert.equal(code(() => synth(rows, 'ing:s/in.a', set.items.map((i) => i.row))), 'NOTHING_TO_IMPORT', 'a second import of the same endpoint brings nothing');
});

test('what the design already has is kept even if it was edited: alreadyHere says it differs', () => {
  const rows: ItemRow[] = [hdr('s'), fn('s', 'a', [{ seq: 1, type: 'call', target: 'b' }]), fn('s', 'b'), ing('s', 'in.a', 'http:GET s/a', 'a')];
  const set = synth(rows, 'ing:s/in.a', [hdr('s'), fn('s', 'b', [{ seq: 1, type: 'call', kind: 'leaf', note: 'x' }])]);
  assert.deepEqual(set.alreadyHere.map((a) => [a.anchor, a.differs]), [['fn:s/b', true]]);
  assert.deepEqual(anchors(set), ['ingress:ingress:s/in.a', 'handler:functions:s/a']);
  assert.match(previewOf(set, 'ing:s/in.a', 'src').warnings.join(), /1 item\(s\) already in this design differ from src: kept as in this design/);
});
