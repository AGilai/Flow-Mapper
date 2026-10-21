// The subsystem level (core/subsystem-rollup.ts): calls rolled up by (from subsystem, to subsystem, transport, mode), each call counted once.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { systemGraph } from '../core/system-graph.ts';
import { callInfo, membershipOf, subsystemsOf, topOf } from '../core/subsystems.ts';
import { lineMark, rollUp } from '../core/subsystem-rollup.ts';
import { generateMock } from '../scripts/mock/generate.ts';
import { graphOf, linkRows, rows, subRows } from './subsystem-fixture.ts';

test('topOf: the first segment of a groupPath', () => {
  assert.equal(topOf('platform/identity'), 'platform'); assert.equal(topOf('platform'), 'platform'); assert.equal(topOf(''), ''); assert.equal(topOf(undefined), '');
});

test('hand fixture: lines, totals per box, the dangling call, and Not set only because loose takes part in a call', () => {
  const rs = rows(), m = rollUp(graphOf(rs), subRows(rs), linkRows(rs));
  assert.deepEqual(m.boxes.map((b) => b.key), ['agent', 'network', 'platform', ''], 'settings order, then Not set last');
  assert.deepEqual(m.lines.map((l) => [l.from, l.to, l.transport, l.mode, l.count]), [
    ['agent', 'network', 'http', 'sync', 1], ['network', 'platform', 'http', 'sync', 2], ['', 'platform', 'http', 'sync', 1]]);
  const b = Object.fromEntries(m.boxes.map((x) => [x.key, x]));
  assert.deepEqual([b.network.out, b.network.in, b.network.dangling], [2, 1, 1]);
  assert.equal(b.platform.internal, 1, 'auth-svc -> users-svc stays inside Platform');
  assert.equal(b.platform.in, 3);
  assert.equal(m.notSet, true);
  assert.deepEqual(b[''].components.map((c) => c.name), ['loose']);
  // a component's subsystem is one: it is in exactly one box
  assert.equal(m.boxes.flatMap((x) => x.components).length, 6);
});

test('Not set has no box when no call involves a component without a subsystem', () => {
  const rs = rows().filter((r) => r.service !== 'loose'), m = rollUp(graphOf(rs), subRows(rs), []);
  assert.equal(m.notSet, false);
  assert.ok(!m.boxes.some((x) => x.key === ''));
});

test('a groupPath top with no settings row is a derived subsystem, labelled with its key, after the settings ones', () => {
  const rs = rows().filter((r) => !(r.list === 'subsystem' && r.key === 'network'));
  const subs = subsystemsOf(subRows(rs), graphOf(rs).model.services);
  assert.deepEqual(subs.map((s) => [s.key, s.label, s.derived]), [['agent', 'Agent', false], ['platform', 'Platform', false], ['network', 'network', true]]);
  assert.deepEqual(subs[2].components.map((c) => c.name), ['pop-edge']);
});

test('an amqp-rpc: bind key is an rpc call; a call through a channel is async unless the call says otherwise', () => {
  const g = graphOf(rows());
  const e = { ...g.model.egress[0], bindKey: 'amqp-rpc:queue', transport: 'amqp' as const, mode: undefined };
  const d = g.model.ingress[0];
  const c = callInfo(e as any, d, false, membershipOf(g.model.services));
  assert.deepEqual([c.transport, c.mode], ['rpc', 'sync']);
  assert.equal(callInfo({ ...e, bindKey: 'sqs:q', transport: 'sqs' } as any, d, true, new Map()).mode, 'async');
  assert.equal(callInfo({ ...e, mode: 'sync' } as any, d, true, new Map()).mode, 'sync');
});

test('lineMark: new when every call is new, changed when some is new or changed', () => {
  const rs = rows(), m = rollUp(graphOf(rs), subRows(rs), []);
  const line = m.lines.find((l) => l.from === 'network')!;
  const [a, b] = line.calls.map((c) => `egr:${c.from.service}/${c.from.egress}`);
  assert.equal(lineMark(line, { [a]: { mark: 'new' }, [b]: { mark: 'new' } }), 'new');
  assert.equal(lineMark(line, { [a]: { mark: 'new' } }), 'changed');
  assert.equal(lineMark(line, { [b]: { mark: 'changed' } }), 'changed');
  assert.equal(lineMark(line, {}), null);
});

test('the order is deterministic and the result is memoised per graph and rows', () => {
  const rs = rows(), g = graphOf(rs), s = subRows(rs), l = linkRows(rs);
  const a = rollUp(g, s, l);
  assert.equal(rollUp(g, s, l), a, 'same graph and rows: the same object');
  assert.deepEqual(rollUp(graphOf(rows().reverse()), subRows(rows().reverse()), []), { ...a, abstract: [] } as any);
});

test('100 mock services (groupPath = team): lines equal a brute force over systemGraph, and a warm roll-up is fast', () => {
  const model: any = { env: 'scale', services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };
  for (const m of generateMock({ services: 100, seed: 7, env: 'scale' })) {
    model.services.push({ ...m.service, groupPath: m.service.team, version: m.version, harvestedAt: m.harvestedAt });
    for (const l of ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings']) for (const e of m[l] ?? []) model[l].push({ ...e, service: m.service.name, ...(l === 'functions' ? { steps: e.steps ?? [] } : {}) });
  }
  const g = buildIndex(model), none: any[] = [];
  const cold = performance.now(); const map = rollUp(g, none, none); const coldMs = performance.now() - cold;
  const top = (s: string) => topOf(g.services.get(s)?.groupPath);
  const want = new Map<string, Set<string>>();
  let internal = 0, calls = 0;
  for (const edge of systemGraph(g).collapsedEdges) {
    if (edge.broken) continue;
    for (const ep of edge.endpoints) {
      const [fs, fe] = ep.from.split(':'), [ts, ti] = ep.to.split(':'), eg = g.egress.get(`${fs}:${fe}`)!;
      const transport = ep.bindKey.startsWith('amqp-rpc:') ? 'rpc' : eg.transport, mode = eg.mode ?? (ep.via === 'direct' ? 'sync' : 'async');
      calls++;
      if (top(fs) === top(ts)) { internal++; continue; }
      const id = `${top(fs)}>${top(ts)}|${transport}|${mode}`;
      want.set(id, (want.get(id) ?? new Set()).add(`${fs}/${fe}>${ts}/${ti}`));
    }
  }
  assert.deepEqual(new Map(map.lines.map((l) => [l.id, new Set(l.calls.map((c) => `${c.from.service}/${c.from.egress}>${c.to.service}/${c.to.ingress}`))])), want);
  assert.equal(map.boxes.reduce((n, b) => n + b.internal, 0), internal);
  assert.equal(map.lines.reduce((n, l) => n + l.count, 0) + internal, calls);
  assert.ok(map.lines.some((l) => l.count > 1));
  const warm: number[] = [];
  for (let i = 0; i < 5; i++) { const t = performance.now(); rollUp(g, none.slice(), none.slice()); warm.push(performance.now() - t); }   // new arrays: the memo misses, so this is the real cost
  const best = Math.min(...warm);
  console.log(`# roll-up on 100 mock services: ${map.boxes.length} boxes, ${map.lines.length} lines; cold ${coldMs.toFixed(0)} ms, warm (memo miss) best ${best.toFixed(0)} ms`);
  assert.ok(best < 100, `warm roll-up took ${best} ms`);
});
