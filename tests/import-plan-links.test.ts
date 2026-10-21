// The subsystem and link parts of an import plan (core/import-plan-links.ts, planToOps): links, environment.groups, TWO_GROUPS. Pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanError, planToOps } from '../core/import-plan.ts';
import { draftManifests } from '../core/draft-manifests.ts';
import { rowsToModel, rowsToExtras, type ItemRow } from '../core/item-rows.ts';
import { rows } from './subsystem-fixture.ts';

const cx = { env: 't', groups: [], validateManifest: () => [], baselineVersion: () => undefined };
const plan = (extra: any) => ({ planVersion: 1, ...extra });
const run = (extra: any, rs: ItemRow[] = rows()) => planToOps(plan(extra), rs, cx);
const link = (over: any = {}) => ({ id: 'usage-metering', name: 'usage metering', from: 'grp:network', to: 'grp:platform', mode: 'async', transport: null, description: 'd', doc: { file: 'a.md' }, ...over });

test('an abstract link becomes one link: op (null transport left out); the counts say so', () => {
  const r = run({ links: [link()] });
  assert.deepEqual(r.ops, [{ op: 'upsert', anchor: 'link:usage-metering', data: { name: 'usage metering', from: 'grp:network', to: 'grp:platform', mode: 'async', description: 'd', doc: { file: 'a.md' } } }]);
  assert.deepEqual(r.links, { abstract: 1, flow: 0, skipped: 0 }); assert.deepEqual(r.skipped, { links: 0 });
});

test('the id defaults to the slug of the name; a link may end at a component, an endpoint, and start at a call', () => {
  const r = run({ links: [link({ id: undefined, name: 'Push Config Update!' }), link({ id: 'a', from: 'egr:pop-edge/out.auth', to: 'ing:auth-svc/in.token' }), link({ id: 'b', from: 'svc:pop-edge', to: 'svc:auth-svc' })] });
  assert.deepEqual(r.ops.map((o) => o.anchor), ['link:push-config-update', 'link:a', 'link:b']);
});

test('a bad link is a warning and is skipped, so the rest of the plan imports', () => {
  const r = run({ links: [link({ to: 'grp:nowhere' }), link({ id: 'ok' }), link({ id: 'Bad Id!' }), link({ id: 'c', name: '' }), link({ id: 'd', to: 'egr:pop-edge/out.auth' }), 'text'] });
  assert.deepEqual(r.ops.map((o) => o.anchor), ['link:ok']);
  assert.deepEqual(r.links, { abstract: 1, flow: 0, skipped: 5 }); assert.equal(r.skipped.links, 5);
  assert.match(r.warnings[0], /^links\[0\]: to 'grp:nowhere' does not exist.*skipped$/);
  assert.ok(r.warnings.some((w) => /^links\[2\]: id 'Bad Id!'/.test(w)));
});

test('a flow-shaped entry (typed, flow ends) is skipped with the 0.28.2 warning; a type with other ends is skipped too', () => {
  const r = run({ links: [{ from: 'flow:pop-edge/in.tunnel', to: 'flow:auth-svc/in.token', type: 'contradicts' }, { from: { service: 'a', ingress: 'i' }, to: { service: 'b', ingress: 'j' }, type: 'same-topic' }, link({ id: 'z', type: 'variant-of' })] });
  assert.equal(r.ops.length, 0);
  assert.deepEqual(r.links, { abstract: 0, flow: 0, skipped: 3 });
  assert.match(r.warnings[0], /flow relations land in 0\.28\.2/); assert.match(r.warnings[1], /flow relations land in 0\.28\.2/); assert.match(r.warnings[2], /not flows/);
});

test('a link may end at a component the same plan creates', () => {
  const m = { schemaVersion: '1.0', kind: 'full', env: 't', version: 1, harvestedAt: 'x', service: { name: 'fresh', kind: 'service', groupPath: 'agent' } };
  const r = run({ manifests: [m], links: [link({ id: 'f', from: 'svc:fresh', to: 'grp:platform' })] });
  assert.deepEqual(r.ops.map((o) => o.anchor), ['svc:fresh', 'link:f']);
});

test('environment.groups: keys the environment lacks become subsystem ops after its own, with a valid icon; a label clash is a warning', () => {
  const r = run({ environment: { groups: [{ key: 'platform', label: 'Platform' }, { key: 'edge', label: 'Edge', icon: 'cloud' }, { key: 'misc', label: 'Misc', icon: 'rocket' }, { key: 'agent', label: 'Agents' }, { key: 'Bad', label: 'x' }] }, links: [] });
  assert.deepEqual(r.ops.map((o) => [o.anchor, o.data]), [['grp:edge', { label: 'Edge', icon: 'cloud', order: 3 }], ['grp:misc', { label: 'Misc', order: 4 }]]);
  assert.ok(r.warnings.some((w) => /subsystem 'agent'.*'Agents'.*'Agent'.*environment's is kept/.test(w)));
  assert.ok(r.warnings.some((w) => /icon 'rocket'/.test(w))); assert.ok(r.warnings.some((w) => /"key":"Bad"/.test(w)));
});

test('TWO_GROUPS: details.alsoIn or alsoIn on a manifest or extension; two groupPaths for one component; the same top twice is fine', () => {
  const m = (service: any) => ({ schemaVersion: '1.0', kind: 'full', env: 't', version: 1, harvestedAt: 'x', service: { name: 'fresh', kind: 'service', ...service } });
  const codes = (extra: any) => { try { run(extra); return []; } catch (e) { return (e as PlanError).issues.map((i) => `${i.code} ${i.path}`); } };
  assert.deepEqual(codes({ manifests: [m({ details: { alsoIn: ['platform'] } })] }), ['TWO_GROUPS manifests[0].service.details.alsoIn']);
  assert.deepEqual(codes({ manifests: [m({ alsoIn: ['platform'] })] }), ['TWO_GROUPS manifests[0].service.alsoIn']);
  assert.deepEqual(codes({ extensions: [{ service: 'auth-svc', alsoIn: ['agent'], upsert: {} }] }), ['TWO_GROUPS extensions[0].alsoIn']);
  assert.deepEqual(codes({ extensions: [{ service: 'auth-svc', details: { alsoIn: ['agent'] }, upsert: {} }] }), ['TWO_GROUPS extensions[0].details.alsoIn']);
  assert.deepEqual(codes({ manifests: [m({ groupPath: 'agent' })], extensions: [{ service: 'fresh', groupPath: 'platform', upsert: {} }] }), ['TWO_GROUPS extensions[0].groupPath']);
  assert.deepEqual(codes({ manifests: [m({ groupPath: 'platform' })], extensions: [{ service: 'fresh', groupPath: 'platform/identity', upsert: {} }] }), []);
  assert.deepEqual(codes({ extensions: [{ service: 'auth-svc', groupPath: 'agent', upsert: {} }, { service: 'auth-svc', groupPath: 'network', upsert: {} }] }), ['TWO_GROUPS extensions[1].groupPath']);
  try { run({ extensions: [{ service: 'auth-svc', alsoIn: ['agent'], upsert: {} }] }); } catch (e) { assert.match((e as PlanError).issues[0].message, /pick one/); }
});

test('an extension of a component the plan creates keeps the manifest header (it used to be replaced by a bare header)', () => {
  const m = { schemaVersion: '1.0', kind: 'full', env: 't', version: 1, harvestedAt: 'x', service: { name: 'fresh', kind: 'gateway', team: 'net' } };
  const r = run({ manifests: [m], extensions: [{ service: 'fresh', groupPath: 'agent', upsert: {} }] });
  assert.deepEqual(r.ops.filter((o) => o.anchor === 'svc:fresh').pop()!.data, { kind: 'gateway', team: 'net', groupPath: 'agent' });
});

test('design lists never reach a manifest: only link / subsystem ops builds no manifest and no service "" delta; the rows model and extras ignore them', () => {
  const net = [{ op: 'upsert', anchor: 'link:l', service: '', list: 'link', key: 'l', data: { name: 'l', from: 'grp:network', to: 'grp:platform' }, seq: 1, baseHash: null, author: 'a', byAi: false, at: 't' },
    { op: 'upsert', anchor: 'grp:x', service: '', list: 'subsystem', key: 'x', data: { label: 'X', order: 3 }, seq: 2, baseHash: null, author: 'a', byAi: false, at: 't' }];
  const dm = draftManifests(net as any, rows(), 'now', 't');
  assert.deepEqual([dm.manifests, dm.deletes, dm.side.map((o) => o.list)], [[], [], ['link', 'subsystem']]);
  assert.deepEqual(rowsToModel('t', rows()).services.map((s) => s.name).sort(), ['auth-svc', 'billing-svc', 'loose', 'pop-edge', 'sase-agent', 'users-svc']);
  assert.deepEqual(rowsToExtras(rows()), { dtos: [], eventDtos: [], schemas: [], flows: new Map() });
});
