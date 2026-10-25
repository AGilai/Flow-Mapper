// #87 external services: a service whose header carries `details.external: true`. Demo: samples/ext-payments-gateway.json,
// called over http by payments-svc `charge` (so by the api-gateway createOrder flow). Spec: docs/plans/external-services.md.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { isExternal, externalSet, externalField, splitCount, servicesText } from '../core/external.ts';
import { flowCounts, describeCount } from '../core/flow-counts.ts';
import { health } from '../core/health.ts';
import { trace } from '../core/trace.ts';
import { sampleManifests, sampleModel, startApp } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { externalCls, externalTag as laneTag } from '../web/js/views/flow-draw-external.js';
// @ts-ignore
import { scopePoints, componentRows } from '../web/js/views/flow-list-filter.js';
// @ts-ignore
import { drawNode } from '../web/js/graph/graph-style.js';
// @ts-ignore
import { drawLabels } from '../web/js/graph/graph-draw-labels.js';

const EXT = 'ext-payments-gateway', CHK = 'ext-checkpoint-cloud';
const g = buildIndex(sampleModel());

test('classification: only the boolean true is external', () => {
  assert.equal(isExternal({ external: true }), true);
  for (const v of [false, 'true', 1, null, undefined, {}]) assert.equal(isExternal({ external: v }), false, String(v));
  assert.equal(isExternal(undefined), false);
  assert.deepEqual([...externalSet(g)].sort(), [CHK, EXT]); // ext-checkpoint-cloud: the #89 demo stub
  assert.deepEqual(externalField(g, EXT), { external: true });
  assert.deepEqual(externalField(g, 'payments-svc'), {});
  assert.deepEqual(externalField(g, undefined), {});
});

test('counts split and text: "N services · M external", M omitted at 0', () => {
  assert.deepEqual(splitCount(['a', 'b', 'x'], new Set(['x'])), { internal: 2, external: 1 });
  assert.equal(servicesText(3, 0), '3 services');
  assert.equal(servicesText(1, 0), '1 service');
  assert.equal(servicesText(4, 1), '4 services · 1 external');
  assert.equal(servicesText(2, 1, 'component'), '2 components · 1 external');
});

test('flow counts: external is a subset of services; the tooltip splits it', () => {
  const c = flowCounts(g).find((x) => x.service === 'api-gateway' && x.ingress === 'in.createOrder')!;
  assert.equal(c.external, 1);
  assert.match(describeCount(c), new RegExp(`${c.services - 1} services · 1 external`));
  const other = flowCounts(g).find((x) => x.external === 0)!;
  assert.doesNotMatch(describeCount(other), /external/);
});

test('trace: the external lifeline is flagged, the call to it is an ordinary resolved message', () => {
  const t = trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full', maxMessages: 800 })!;
  const p = t.participants.find((x) => x.service === EXT)!;
  assert.equal(p.external, true);
  assert.ok(!t.participants.some((x) => x.service !== EXT && x.external));
  const m = t.messages.find((x) => x.to === p.id)!;
  assert.ok(m && !m.broken && !m.gap && !m.blocked, 'resolved, no gap, no broken');
  assert.ok(!t.messages.some((x) => (x.to === p.id || x.from === p.id) && (x.broken || x.gap || x.blocked)));
});

test('link health: a call to an external service is not a problem, nor is its endpoint "never called"', () => {
  const h = health(g);
  assert.ok(!h.items.dangling.some((d) => String(d.bindKey).includes(EXT)));
  assert.ok(!h.items.orphans.some((o) => o.service === EXT));
  assert.equal(h.totals.external, 2);
  assert.equal(h.services.find((s) => s.service === EXT)!.external, true);
  assert.equal(h.services.find((s) => s.service === 'payments-svc')!.external, undefined);
  // an external endpoint nobody harvested a caller for is still no problem (a plain service's would be an orphan)
  const m = sampleModel();
  m.egress = m.egress.filter((e: any) => !String(e.bindKey).includes(EXT));
  const lone = buildIndex(m);
  assert.ok(lone.resolution.orphans.some((o) => o.service === EXT), 'the resolver still sees it as uncalled');
  assert.ok(!health(lone).items.orphans.some((o) => o.service === EXT));
  const m2 = sampleModel();
  m2.egress = m2.egress.filter((e: any) => !String(e.bindKey).includes(EXT));
  m2.services.find((s: any) => s.name === EXT).details = {};
  assert.ok(health(buildIndex(m2)).items.orphans.some((o) => o.service === EXT), 'internal, the same endpoint is an orphan');
});

let app: Awaited<ReturnType<typeof startApp>>;
before(async () => { app = await startApp(); assert.equal((await app.call('POST', '/api/ingest', { manifests: sampleManifests() })).status, 201); });
after(() => app.close());
const get = async (path: string) => (await app.call('GET', `/api/envs/prod${path}`)).body;

test('API: map, inventory, service view, entry points, flow counts carry `external` on the external service only', async () => {
  const map = await get('/views/system');
  assert.deepEqual(map.nodes.filter((n: any) => n.external).map((n: any) => n.label).sort(), [CHK, EXT]);
  assert.equal(map.nodes.find((n: any) => n.label === 'payments-svc').external, undefined);
  assert.equal(map.edges.some((e: any) => e.broken && (e.to === `svc:${EXT}` || e.from === `svc:${EXT}`)), false);
  const inv = await get('/inventory');
  assert.deepEqual(inv.filter((x: any) => x.external).map((x: any) => x.id).sort(), [CHK, EXT]);
  const sv = await get(`/views/service/${EXT}`);
  assert.equal(sv.external, true);
  assert.equal(sv.service.external, undefined, 'the header itself is as stored');
  assert.equal(sv.service.details.external, true);
  assert.equal(sv.ingress[0].orphan, false);
  assert.deepEqual(sv.ingress[0].callers.map((c: any) => c.service), ['payments-svc']);
  assert.equal((await get('/views/service/payments-svc')).external, undefined);
  const eps = await get('/entry-points');
  assert.ok(eps.filter((e: any) => e.external).every((e: any) => e.service === EXT || e.service === CHK));
  assert.ok(eps.every((e: any) => e.external === undefined || e.external === true));
  const counts = await get('/flows/counts');
  assert.equal(counts.find((c: any) => c.service === 'api-gateway' && c.ingress === 'in.createOrder').external, 1);
  const tr = await get('/trace?service=api-gateway&ingress=in.createOrder');
  assert.equal(tr.participants.find((p: any) => p.service === EXT).external, true);
  const hl = await get('/health');
  assert.equal(hl.totals.external, 2);
});

test('MCP: list_services, get_service, list_entry_points, inventory and trace_flow carry the field', async () => {
  const tool = async (name: string, args: any) => JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { env: 'prod', ...args } } })).body.result.content[0].text);
  assert.deepEqual((await tool('list_services', {})).filter((s: any) => s.external).map((s: any) => s.service).sort(), [CHK, EXT]);
  assert.equal((await tool('get_service', { service: EXT })).external, true);
  assert.equal((await tool('get_service', { service: 'payments-svc' })).external, undefined);
  assert.ok((await tool('inventory', { type: 'service' })).some((x: any) => x.id === EXT && x.external === true));
  assert.ok((await tool('trace_flow', { service: 'api-gateway', ingress: 'in.createOrder' })).participants.some((p: any) => p.service === EXT && p.external === true));
  assert.ok((await tool('list_entry_points', {})).every((e: any) => e.external === undefined || e.service === EXT || e.service === CHK));
});

test('a non-boolean `external` is internal everywhere', async () => {
  const m = sampleManifests().find((x: any) => x.service.name === EXT);
  const a = await startApp();
  try {
    const other = JSON.parse(JSON.stringify(m)); other.service.details = { external: 'true' };
    assert.equal((await a.call('POST', '/api/ingest', { manifests: [other] })).status, 201);
    assert.equal((await a.call('GET', `/api/envs/prod/views/service/${EXT}`)).body.external, undefined);
  } finally { await a.close(); }
});

// ---- render level: the modifier class and the tag, no DOM needed (a tiny stand-in for the SVG helpers) ----
class FakeNode {
  tag: string; attrs: Record<string, any> = {}; kids: any[] = [];
  constructor(tag: string) { this.tag = tag; }
  setAttribute(k: string, v: any) { this.attrs[k] = String(v); }
  append(...c: any[]) { this.kids.push(...c); }
  text(): string { return this.kids.map((k) => (typeof k === 'string' ? k : k.text?.() ?? '')).join(''); }
}
(globalThis as any).Node = FakeNode;
(globalThis as any).document = { createElementNS: (_n: string, t: string) => new FakeNode(t), createTextNode: (t: string) => String(t) };

test('lane: an external service gets a lane column flagged external, no internal-call pill', () => {
  const t = trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full', maxMessages: 800 })!;
  const lane = buildLane(t.messages, { scope: t.scope, participants: t.participants });
  const col = lane.columns.find((c: any) => c.service === EXT);
  assert.equal(col.external, true);
  assert.ok(lane.columns.filter((c: any) => c.kind === 'service' && c.service !== EXT).every((c: any) => !c.external));
  assert.ok(!lane.events.some((e: any) => e.type === 'pill' && e.bar.service === EXT));
});

test('lane head helpers: modifier class on external service heads only; the tag is real text', () => {
  assert.equal(externalCls({ kind: 'service', external: true }), ' ext');
  assert.equal(externalCls({ kind: 'service' }), '');
  assert.equal(externalCls({ kind: 'resource', external: true }), '');
  assert.equal(laneTag({ kind: 'service' }, 120, 50), null);
  const tag = laneTag({ kind: 'service', external: true, label: EXT }, 120, 50);
  assert.equal(tag.attrs.class, 'ext-pill');
  assert.match(tag.text(), /external/);
});

test('flows list: external ingress are hidden unless "All endpoints"; the component row carries the flag', () => {
  const pts = [{ service: 'a', id: 'in.a', name: 'A', entryPoint: true }, { service: EXT, id: 'in.authorize', external: true, entryPoint: true }];
  for (const design of [false, true]) {
    assert.deepEqual(scopePoints(pts, { design, service: null, all: false }).map((p: any) => p.service), ['a']);
    assert.deepEqual(scopePoints(pts, { design, service: null, all: true }).map((p: any) => p.service), ['a', EXT]);
  }
  assert.deepEqual(componentRows(pts, new Map(), null).map((r: any) => [r.name, !!r.external]), [['a', false], [EXT, true]]);
});

test('map: an external node is drawn with a dashed grey outline and a muted fill; the label carries the text tag', () => {
  const calls: string[] = [];
  const ctx: any = new Proxy({}, { get: (_t, k: string) => (k === 'measureText' ? () => ({ width: 40 }) : (...a: any[]) => { calls.push(`${k}${a.length ? `:${a.join(',')}` : ''}`); }), set: (_t, k: string, v) => { calls.push(`${k}=${v}`); return true; } });
  const theme = { surface: '#fff', extFill: '#eef', extLine: '#789', extInk: '#456', ink: '#000', ink2: '#333', accent: '#00f', broken: '#f00', halo: '#fff', cmp: [], font: 'x' };
  const node = (external?: boolean) => ({ id: 'svc:x', kind: 'service', label: 'x', service: 'x', svcKind: 'service', stats: { functions: 0, dangling: 0 }, ...(external ? { external: true } : {}) });
  drawNode(ctx, node(true), [10, 10], 1, new Map(), theme, {});
  assert.ok(calls.includes('fillStyle=#eef') && calls.includes('strokeStyle=#789') && calls.includes('setLineDash:4,3'), calls.join(' '));
  calls.length = 0;
  drawNode(ctx, node(), [10, 10], 1, new Map(), theme, {});
  assert.ok(!calls.includes('fillStyle=#eef') && !calls.some((c) => c.startsWith('setLineDash:4')), 'an internal node is unchanged');
  calls.length = 0;
  const S = { selected: null, hovered: null, degree: new Map(), k: 1, toScreen: (p: any) => p, pos: new Map([['svc:x', [50, 50]]]), w: 400, hgt: 300, theme };
  drawLabels(ctx, S, [node(true)], null, () => false);
  assert.ok(calls.includes('fillText:external,' + calls.find((c) => c.startsWith('fillText:external'))!.split(',')[1] + ',50'), calls.join(' '));
});
