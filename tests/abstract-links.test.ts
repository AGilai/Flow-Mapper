// Abstract links (core/abstract-links.ts, core/link-suggest.ts): the rules of a link, ends and scopes, the five states, suggestions.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkLink, endOf, inside, linkViews, worldOfGraph, worldOfRows } from '../core/abstract-links.ts';
import { suggestRefinements } from '../core/link-suggest.ts';
import { rollUp } from '../core/subsystem-rollup.ts';
import type { ItemRow } from '../core/item-rows.ts';
import { graphOf, linkRows, rows, subRows } from './subsystem-fixture.ts';

const link = (key: string, data: any): ItemRow => ({ service: '', list: 'link', key, data });
const codes = (id: string, data: any, rs = rows()) => checkLink(id, data, rs).map((i) => i.code);
const ok = { name: 'usage metering', from: 'grp:network', to: 'grp:platform', mode: 'async' };

test('checkLink: a good link has no issue; every code', () => {
  assert.deepEqual(codes('usage-metering', ok), []);
  assert.deepEqual(codes('Bad Id', ok), ['BAD_NAME']);
  assert.deepEqual(codes('x', { ...ok, name: '' }), ['INVALID']);
  assert.deepEqual(codes('x', { ...ok, name: 'n'.repeat(201) }), ['INVALID']);
  assert.deepEqual(codes('x', { ...ok, to: 'egr:pop-edge/out.auth' }), ['BAD_END'], 'a `to` of kind egr:');
  assert.deepEqual(codes('x', { ...ok, from: 'flow:pop-edge/in.tunnel' }), ['BAD_END']);
  assert.deepEqual(codes('x', { ...ok, from: 'nonsense' }), ['BAD_END']);
  assert.deepEqual(codes('x', { ...ok, to: 'grp:nowhere' }), ['NO_END']);
  assert.deepEqual(codes('x', { ...ok, to: 'svc:ghost' }), ['NO_END']);
  assert.deepEqual(codes('x', { ...ok, from: 'egr:pop-edge/none' }), ['NO_END']);
  assert.deepEqual(codes('x', { ...ok, to: 'grp:network' }), ['SAME_END']);
  assert.deepEqual(codes('x', { ...ok, mode: 'both' }), ['INVALID']);
  assert.deepEqual(codes('x', { ...ok, transport: 'carrier-pigeon' }), ['INVALID']);
  assert.deepEqual(codes('x', { ...ok, transport: null }), [], 'null = not decided yet');
  assert.deepEqual(codes('x', { ...ok, description: 'd'.repeat(4001) }), ['INVALID']);
  assert.deepEqual(codes('x', { ...ok, refinedBy: [{ service: 'pop-edge', egress: 'out.auth' }] }), []);
  assert.deepEqual(codes('x', { ...ok, refinedBy: [{ service: 'pop-edge', egress: 'gone' }] }), ['NO_END']);
  assert.deepEqual(codes('x', { ...ok, refinedBy: Array.from({ length: 21 }, () => ({ service: 'pop-edge', egress: 'out.auth' })) }), ['INVALID']);
  assert.deepEqual(codes('x', 'text' as any), ['INVALID']);
});

test('a grp: end may be a groupPath top that has no settings row (derived)', () => {
  const rs = rows().filter((r) => !(r.list === 'subsystem' && r.key === 'network'));
  assert.deepEqual(codes('x', ok, rs), []);
});

test('endOf: the level of each end, its subsystem, and missing', () => {
  const w = worldOfRows(rows());
  assert.deepEqual(endOf('grp:network', w), { anchor: 'grp:network', level: 'subsystem', subsystem: 'network' });
  assert.deepEqual(endOf('svc:auth-svc', w), { anchor: 'svc:auth-svc', level: 'component', subsystem: 'platform', service: 'auth-svc' });
  assert.deepEqual(endOf('egr:pop-edge/out.auth', w), { anchor: 'egr:pop-edge/out.auth', level: 'endpoint', subsystem: 'network', service: 'pop-edge', item: 'out.auth' });
  assert.equal(endOf('ing:auth-svc/gone', w).missing, true);
  assert.equal(endOf('grp:nowhere', w).missing, true);
  assert.equal(endOf('svc:loose', w).subsystem, '');
});

test('inside: a subsystem holds its components and their endpoints, a component its endpoints', () => {
  const w = worldOfRows(rows());
  assert.ok(inside('grp:platform', 'svc:auth-svc', w)); assert.ok(inside('grp:platform', 'ing:users-svc/in.users', w)); assert.ok(inside('grp:network', 'egr:pop-edge/out.auth', w));
  assert.ok(!inside('grp:network', 'svc:auth-svc', w)); assert.ok(!inside('grp:platform', 'svc:loose', w));
  assert.ok(inside('svc:auth-svc', 'ing:auth-svc/in.token', w)); assert.ok(!inside('svc:auth-svc', 'ing:users-svc/in.users', w));
  assert.ok(inside('grp:network', 'grp:network', w)); assert.ok(!inside('ing:auth-svc/in.token', 'svc:auth-svc', w));
});

const views = (rs: ItemRow[]) => { const g = graphOf(rs); return linkViews(g, linkRows(rs), worldOfGraph(g, subRows(rs))); };
const state = (rs: ItemRow[], id: string) => views(rs).find((v) => v.id === id)!;

test('states: abstract, partial, ready, refined (id on its roll-up line), broken', () => {
  const rs = rows();
  rs.push(link('a', ok), link('p', { ...ok, name: 'p', from: 'svc:pop-edge' }), link('r', { name: 'r', from: 'egr:sase-agent/out.pop', to: 'ing:pop-edge/in.tunnel' }),
    link('f', { name: 'f', from: 'egr:pop-edge/out.auth', to: 'ing:auth-svc/in.token', refinedBy: [{ service: 'pop-edge', egress: 'out.auth' }] }));
  assert.equal(state(rs, 'a').state, 'abstract'); assert.equal(state(rs, 'p').state, 'partial'); assert.equal(state(rs, 'r').state, 'ready');
  const f = state(rs, 'f');
  assert.equal(f.state, 'refined'); assert.equal(f.line, 'network>platform|http|sync'); assert.deepEqual(f.refinedBy, [{ service: 'pop-edge', egress: 'out.auth', to: { service: 'auth-svc', ingress: 'in.token' } }]);
  const m = rollUp(graphOf(rs), subRows(rs), linkRows(rs));
  assert.deepEqual(m.lines.find((l) => l.id === 'network>platform|http|sync')!.links, ['f'], 'the refined link is on its line');
  assert.equal(m.abstract.length, 4);

  const noCall = rs.map((r) => (r.service === 'pop-edge' && r.list === 'egress' && r.key === 'out.auth' ? { ...r, key: 'out.auth2', data: { ...r.data, id: 'out.auth2' } } : r));
  const broken = state(noCall, 'f');
  assert.equal(broken.state, 'broken'); assert.match(broken.problems[0], /no longer exists/);
  const gone = state(rs.filter((r) => r.service !== 'auth-svc'), 'f');
  assert.equal(gone.state, 'broken'); assert.equal(gone.to.missing, true);
  const noMore = rs.map((r) => (r.service === 'pop-edge' && r.key === 'out.auth' ? { ...r, data: { ...r.data, bindKey: 'http:POST nobody/token' } } : r));
  assert.match(state(noMore, 'f').problems.join(' '), /no longer reaches/);
  const endGone = state(rs.filter((r) => !(r.service === 'pop-edge' && r.list === 'header')), 'p');
  assert.equal(endGone.state, 'broken'); assert.equal(endGone.from.missing, true);
});

test('suggestRefinements: the existing calls between the two ends, the matching mode first, then components of an open end', () => {
  const rs = rows(), id = (m?: string) => link('usage-metering', { ...ok, ...(m ? { mode: m } : { mode: undefined }), transport: 'http' });
  rs.push(id('sync'));
  const g = graphOf(rs), map = rollUp(g, subRows(rs), linkRows(rs)), v = map.abstract[0];
  const s = suggestRefinements(v, map, g, subRows(rs));
  assert.deepEqual(s.slice(0, 2).map((x) => x.use), [{ service: 'pop-edge', egress: 'out.auth' }, { service: 'pop-edge', egress: 'out.users' }]);
  assert.match(s[0].reason, /^pop-edge already calls auth-svc over http \(POST \/token\)$/);
  assert.ok(s.length <= 5);
  assert.ok(s.slice(2).every((x) => x.from || x.to), 'the rest narrow an open end');
  // a link with mode async: the sync calls rank after an async one; with none async they are all still offered
  const rs2 = rows(); rs2.push(link('usage-metering', { ...ok, mode: 'async' }));
  const g2 = graphOf(rs2), map2 = rollUp(g2, subRows(rs2), linkRows(rs2));
  assert.ok(suggestRefinements(map2.abstract[0], map2, g2, subRows(rs2)).every((x) => !x.use), 'an async link is not offered sync calls (0.28 QA)');
  const refined = rows(); refined.push(link('f', { name: 'f', from: 'egr:pop-edge/out.auth', to: 'ing:auth-svc/in.token', refinedBy: [{ service: 'pop-edge', egress: 'out.auth' }] }));
  const g3 = graphOf(refined), map3 = rollUp(g3, subRows(refined), linkRows(refined));
  assert.deepEqual(suggestRefinements(map3.abstract[0], map3, g3, subRows(refined)), [], 'a refined link needs none');
});
