// QA round on 0.28.0: Mermaid reads the draft's subsystems, a move shows in marks with ?draft=, merged move details, no duplicate problems,
// TWO_GROUPS wins the error code, suggestions honour the link's mode.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';
import { draftChanges, netOps, type DraftOp } from '../core/draft-ops.ts';
import { linkViews, worldOfGraph } from '../core/abstract-links.ts';
import { suggestRefinements } from '../core/link-suggest.ts';
import { rollUp } from '../core/subsystem-rollup.ts';
import { graphOf, linkRows, rows, subRows } from './subsystem-fixture.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());
const E = '/api/envs/hld', D = `${E}/drafts`;
let n = 0;
const fresh = async () => { const slug = `f${++n}`; assert.equal((await app.call('POST', D, { name: slug, slug })).status, 201); return slug; };
const edit = (s: string, e: unknown) => app.call('POST', `${D}/${s}/edits`, { edit: e });

test('Mermaid: a subsystem added earlier in the same draft is accepted as groupPath, in preview and import', async () => {
  const s = await fresh(), text = 'sequenceDiagram\nparticipant N as newcomer\nactor X\nX->>N: POST /hello';
  assert.equal((await app.call('POST', `${D}/${s}/mermaid/preview`, { text, groupPath: 'edge' })).status, 422, 'unknown first');
  assert.equal((await edit(s, { kind: 'subsystem', key: 'edge', label: 'Edge' })).status, 201);
  assert.equal((await app.call('POST', `${D}/${s}/mermaid/preview`, { text, groupPath: 'edge' })).status, 200);
  const r = await app.call('POST', `${D}/${s}/mermaid`, { text, groupPath: 'edge' });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});

test('a move shows in marks with ?draft=: svc changed "subsystem: A → B", grp moved out / in; the baseline after apply stays silent', async () => {
  const s = await fresh();
  assert.equal((await edit(s, { kind: 'component', name: 'auth-svc', serviceKind: 'service', groupPath: 'agent' })).status, 201);
  const mr = await app.call('GET', `${E}/marks?draft=${s}`); assert.equal(mr.status, 200, JSON.stringify(mr.body)); const m = mr.body.marks;
  assert.equal(m['svc:auth-svc'].what, 'subsystem: Platform → Agent');
  assert.match(m['grp:platform'].what, /moved out: auth-svc/); assert.match(m['grp:agent'].what, /moved in: auth-svc/);
  assert.equal((await app.call('POST', `${D}/${s}/apply`, { by: 'a' })).status, 200);
  assert.equal((await app.call('GET', `${E}/marks`)).body.marks['svc:auth-svc'], undefined, 'against the baseline: silent');
});

test('draft changes: the move into a subsystem the draft adds is merged into its row; grp rows carry the label', () => {
  const env = rows();
  const op = (seq: number, anchor: string, service: string, list: string, key: string, data: any) => ({ op: 'upsert', anchor, service, list, key, data, seq, baseHash: null, author: 'a', byAi: false, at: 't' }) as DraftOp;
  const hdr = env.find((r) => r.service === 'pop-edge' && r.list === 'header')!;
  const net = netOps([op(1, 'grp:edge', '', 'subsystem', 'edge', { label: 'Edge zone', order: 3 }), op(2, 'svc:pop-edge', 'pop-edge', 'header', '', { ...hdr.data, groupPath: 'edge' })]);
  const items = draftChanges(env, net).items;
  const g = items.filter((i) => i.anchor.startsWith('grp:'));
  assert.deepEqual(g.map((i) => [i.anchor, i.change, i.what, i.under ?? null, i.label]), [
    ['grp:edge', 'added', 'pop-edge moved in', null, 'Edge zone'], ['grp:network', 'changed', 'pop-edge moved out', 'svc:pop-edge', 'Network (POP)']]);
});

test('linkViews: no duplicated problem for a missing refining call that is also the end', () => {
  const rs = rows();
  rs.push({ service: '', list: 'link', key: 'l', data: { name: 'l', from: 'egr:pop-edge/gone', to: 'grp:platform', refinedBy: [{ service: 'pop-edge', egress: 'gone' }] } });
  const g = graphOf(rs), v = linkViews(g, linkRows(rs), worldOfGraph(g, subRows(rs)))[0];
  assert.equal(v.problems.length, new Set(v.problems).size); assert.equal(v.state, 'broken');
});

test('TWO_GROUPS is the top-level code: top-level alsoIn on a plan manifest, and a batch that also has a schema error', async () => {
  const s = await fresh();
  const m = { schemaVersion: '1.0', kind: 'full', env: 'hld', version: 1, harvestedAt: 'x', service: { name: 'fresh', kind: 'service', alsoIn: ['platform'] } };
  const r = await app.call('POST', `${D}/${s}/plan`, { planVersion: 1, manifests: [m] });
  assert.equal(r.body.error.code, 'TWO_GROUPS'); assert.match(r.body.error.message, /pick one/);
  const b = await app.call('POST', `${D}/${s}/ops`, { ops: [{ op: 'upsert', anchor: 'svc:x', data: { kind: 'service', alsoIn: ['platform'] } }, { op: 'upsert', anchor: 'svc:y', data: { kind: 'nonsense' } }] });
  assert.equal(b.body.error.code, 'TWO_GROUPS');
});

test('suggest_refinements honours the link mode: async offers only async calls, sync only sync, none both', () => {
  const rs = rows();
  rs.find((r) => r.service === 'pop-edge' && r.list === 'egress' && r.key === 'out.auth')!.data.mode = 'async';
  const of = (mode?: string) => {
    const x = rows(); x.splice(0, x.length, ...rs.map((r) => structuredClone(r)));
    x.push({ service: '', list: 'link', key: 'l', data: { name: 'l', from: 'grp:network', to: 'grp:platform', ...(mode ? { mode } : {}) } });
    const g = graphOf(x), map = rollUp(g, subRows(x), linkRows(x));
    return suggestRefinements(map.abstract[0], map, g, subRows(x)).flatMap((s) => (s.use ? [s.use.egress] : []));
  };
  assert.deepEqual(of('async'), ['out.auth']); assert.deepEqual(of('sync'), ['out.users']); assert.deepEqual(of().sort(), ['out.auth', 'out.users']);
});
