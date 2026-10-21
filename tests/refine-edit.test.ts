// Refining an abstract link (core/edit-subsystems.ts refineOps): narrow an end, point it at an existing call (`use`), or make a new call (`call`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { designEditOps, type DesignEdit } from '../core/design-edit.ts';
import { linkViews, worldOfGraph } from '../core/abstract-links.ts';
import { rowId, type ItemRow } from '../core/item-rows.ts';
import { prepareOps } from '../server/store/draft-validate.ts';
import { graphOf, linkRows, rows, subRows } from './subsystem-fixture.ts';

const base = (): ItemRow[] => { const rs = rows(); rs.push({ service: '', list: 'link', key: 'usage-metering', data: { name: 'usage metering', from: 'grp:network', to: 'grp:platform', mode: 'sync' } }); return rs; };
const err = (e: DesignEdit, rs = base()) => { try { designEditOps(e, rs); } catch (x: any) { return `${x.code}${x.field ? `:${x.field}` : ''}`; } return 'no error'; };
function apply(e: DesignEdit, rs = base()) {
  const map = new Map(rs.map((r) => [rowId(r), r])), ops = designEditOps(e, rs);
  prepareOps(map, ops, { groups: [] });
  return { ops, rows: [...map.values()] };
}
const view = (rs: ItemRow[]) => { const g = graphOf(rs); return linkViews(g, linkRows(rs), worldOfGraph(g, subRows(rs))).find((v) => v.id === 'usage-metering')!; };
const data = (ops: ReturnType<typeof designEditOps>) => ops.find((o) => o.anchor === 'link:usage-metering')!.data as any;

test('narrow an end: inside the current one only (NOT_INSIDE); a subsystem narrows to one of its components', () => {
  assert.equal(data(designEditOps({ kind: 'refine-link', id: 'usage-metering', from: 'svc:pop-edge' }, base())).from, 'svc:pop-edge');
  assert.equal(view(apply({ kind: 'refine-link', id: 'usage-metering', from: 'svc:pop-edge', to: 'svc:auth-svc' }).rows).state, 'partial');
  assert.equal(err({ kind: 'refine-link', id: 'usage-metering', from: 'svc:auth-svc' }), 'NOT_INSIDE:from', 'auth-svc is in Platform, not in Network');
  assert.equal(err({ kind: 'refine-link', id: 'usage-metering', to: 'grp:network' }), 'NOT_INSIDE:to');
  assert.equal(err({ kind: 'refine-link', id: 'ghost', to: 'svc:auth-svc' }), 'NO_ITEM:id');
  const narrowed = apply({ kind: 'refine-link', id: 'usage-metering', from: 'egr:pop-edge/out.auth', to: 'ing:auth-svc/in.token' });
  assert.equal(view(narrowed.rows).state, 'ready', 'both ends are endpoints and no call realises it yet');
});

test('a missing end accepts any end (the way out of a broken link)', () => {
  const rs = base().filter((r) => !(r.service === 'pop-edge'));
  rs.find((r) => r.list === 'link')!.data.from = 'svc:pop-edge';
  assert.equal(err({ kind: 'refine-link', id: 'usage-metering', from: 'svc:sase-agent' }, rs), 'no error');
});

test('use: an existing call realises the link; the ends become the call and its endpoint; refinedBy is set', () => {
  const r = apply({ kind: 'refine-link', id: 'usage-metering', use: { service: 'pop-edge', egress: 'out.auth' } });
  assert.deepEqual(data(r.ops), { name: 'usage metering', from: 'egr:pop-edge/out.auth', to: 'ing:auth-svc/in.token', mode: 'sync', refinedBy: [{ service: 'pop-edge', egress: 'out.auth' }] });
  const v = view(r.rows);
  assert.equal(v.state, 'refined'); assert.equal(v.line, 'network>platform|http|sync');
  assert.equal(err({ kind: 'refine-link', id: 'usage-metering', use: { service: 'pop-edge', egress: 'out.nothing' } }), 'NO_ITEM:use');
  assert.equal(err({ kind: 'refine-link', id: 'usage-metering', use: { service: 'sase-agent', egress: 'out.pop' } }), 'NOT_INSIDE:use', 'the call starts outside Network');
  assert.equal(err({ kind: 'refine-link', id: 'usage-metering', use: { service: 'pop-edge', egress: 'out.void' } }), 'NOT_INSIDE:use', 'it reaches nowhere in Platform');
});

test('call: a new call is made in the same request (egress, function step, new endpoint, link upsert); linkViews then says refined', () => {
  const r = apply({ kind: 'refine-link', id: 'usage-metering', call: {
    from: { service: 'pop-edge', fn: 'Tunnel.open' },
    to: { endpoint: { service: 'billing-svc', transport: 'http', bindKey: 'http:POST billing-svc/meter', handler: 'Meter.record' } }, operation: 'report usage' } });
  const kinds = r.ops.map((o) => o.anchor.split(':')[0]);
  assert.deepEqual([kinds.includes('egr'), kinds.includes('ing'), kinds[kinds.length - 1]], [true, true, 'link'], 'the link upsert comes last');
  const d = data(r.ops);
  assert.match(d.from, /^egr:pop-edge\/out\.billing-svc\./); assert.equal(d.to, 'ing:billing-svc/in.meter');
  assert.deepEqual(d.refinedBy, [{ service: 'pop-edge', egress: d.from.split('/')[1] }]);
  const v = view(r.rows);
  assert.equal(v.state, 'refined'); assert.equal(v.line, 'network>platform|http|sync');
  assert.equal(err({ kind: 'refine-link', id: 'usage-metering', call: { from: { service: 'pop-edge', fn: 'Tunnel.open' }, to: { service: 'users-svc', ingress: 'in.users' } } }), 'no error', 'an existing endpoint');
  assert.equal(err({ kind: 'refine-link', id: 'usage-metering', call: { from: { service: 'sase-agent', fn: 'Agent.start' }, to: { service: 'auth-svc', ingress: 'in.token' } } }), 'NOT_INSIDE:call', 'starts outside Network');
  assert.equal(err({ kind: 'refine-link', id: 'usage-metering', call: { from: { service: 'pop-edge', fn: 'Tunnel.open' }, to: { service: 'pop-edge', ingress: 'in.tunnel' } } }), 'NOT_INSIDE:call', 'ends outside Platform');
});

test('REFINE_DANGLING: a call that is not designed yet never refines; use and call are exclusive', () => {
  assert.equal(err({ kind: 'refine-link', id: 'usage-metering', call: { from: { service: 'pop-edge', fn: 'Tunnel.open' }, to: { bindKey: 'http:POST auth-svc/later', transport: 'http' } } }), 'REFINE_DANGLING:call');
  assert.equal(err({ kind: 'refine-link', id: 'usage-metering', use: { service: 'pop-edge', egress: 'out.auth' }, call: { from: { service: 'pop-edge', fn: 'Tunnel.open' }, to: { service: 'auth-svc', ingress: 'in.token' } } }), 'INVALID:use');
});

test('deleting the refining call breaks the link, with a problem; an abstract-link edit puts it back at subsystem level', () => {
  const r = apply({ kind: 'refine-link', id: 'usage-metering', use: { service: 'pop-edge', egress: 'out.auth' } });
  const gone = r.rows.filter((x) => !(x.service === 'pop-edge' && x.list === 'egress' && x.key === 'out.auth'));
  const v = view(gone);
  assert.equal(v.state, 'broken'); assert.match(v.problems.join(' '), /out\.auth/);
  // the way back: put the link at subsystem level again and drop the refinement (an abstract-link edit)
  const back = apply({ kind: 'abstract-link', id: 'usage-metering', name: 'usage metering', from: 'grp:network', to: 'grp:platform', refinedBy: null }, gone);
  assert.equal(view(back.rows).state, 'abstract');
});
