// #85 items 1-5, "Show broken flows": the pure rules (docs/plans/incomplete-flows.md section 3), the trace fields, the lane rows and the Flows list filter.
// Demos: samples/safer-auth.json (two blocked calls in a frontier, coverage incomplete), samples/safer-lookup.json (gap: false only, coverage complete).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { entryPoints } from '../core/entry-points.ts';
import { blockedSites, blockedSteps, coverageOf, listBlocked, listIncomplete, traceBlocked } from '../core/incomplete.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { layoutLane } from '../web/js/views/flow-draw-layout.js';
// @ts-ignore
import { isBlockedEvent } from '../web/js/views/flow-draw-incomplete.js';
// @ts-ignore
import * as T from '../web/js/views/incomplete-pure.js';
// @ts-ignore
import { filterPoints, hasCoverage, incompleteCount, incompleteOn, incompleteParam, isIncompletePoint } from '../web/js/views/flow-list-filter.js';

const g = buildIndex(sampleModel());
const auth = { service: 'safer-auth', ingress: 'in.authenticate' }, lookup = { service: 'safer-lookup', ingress: 'in.find' };
const folded = trace(g, auth, { scope: 'full', maxMessages: 800 })!, open = trace(g, auth, { scope: 'full', frontier: true, maxMessages: 800 })!;

// ---- fixtures: a trace made of plain messages ----
const site = (service: string, fn: string, seq: number, extra: any = {}) => ({ id: `${service}:${fn}#${seq}`, service, fn, seq, ...extra });
const msg = (extra: any = {}): any => ({ from: 'a', to: 'b', label: 'x', mode: 'sync', kind: 'call', depth: 1, ...extra });
const blockedMsg = (service: string, fn: string, seq: number, extra: any = {}) => msg({ service, fn, seq, blocked: site(service, fn, seq, { plain: 'receiver type unknown' }), gap: { what: 'target', reason: 'r', gap: true }, ...extra });

test('N: distinct blocked steps over every service; a step reached twice or with two gap entries counts once', () => {
  const t = { messages: [msg({ kind: 'entry' }), blockedMsg('a', 'f', 1), blockedMsg('a', 'f', 1), blockedMsg('b', 'h', 4), msg({ service: 'b', fn: 'h', seq: 5, gap: { what: 'target', reason: 'builtin', gap: false } })] };
  assert.equal(traceBlocked(t, null).n, 2);
  assert.equal(traceBlocked(t, null).source, 'trace');
  assert.deepEqual(blockedSteps(t).sites.map((s) => s.id), ['a:f#1', 'b:h#4']);
});

test('N: a folded frontier marker counts, once per step, beside the drawn ones; steps past its listed 20 still count', () => {
  const marker = msg({ kind: 'frontier', frontierSteps: 30, frontierBlocked: 25, frontierSites: Array.from({ length: 20 }, (_, i) => site('a', 'f', i + 1)) });
  const t = { messages: [msg({ kind: 'entry' }), blockedMsg('a', 'f', 1), marker] }; // a:f#1 is both drawn and listed in the marker
  assert.equal(traceBlocked(t, null).n, 25 - 20 + 20, 'the drawn duplicate is not counted twice');
  const w = blockedSites(t, null);
  assert.equal(w.sites.length, 20);
  assert.equal(w.more, 5, '"+ 5 more"');
  assert.equal(w.total, 25);
});

test('gap: false (or no gap field) never counts, and a flow with none has no N', () => {
  const t = { messages: [msg({ kind: 'entry' }), msg({ service: 'a', fn: 'f', seq: 1, gap: { what: 'target', reason: 'builtin-receiver', gap: false } }), msg({ service: 'a', fn: 'f', seq: 2, gap: { what: 'target', reason: 'x' } })] };
  assert.equal(traceBlocked(t, null).n, 0);
  assert.equal(blockedSites(t, null).sites.length, 0);
  assert.equal(traceBlocked({ messages: [msg({ kind: 'entry' })] }, { status: 'complete', blocked: 0 }).n, 0);
});

test('fallback: no step carries a gap field, so N is the ingress coverage (its own service only)', () => {
  const cov = { status: 'incomplete' as const, blocked: 3, more: 1, sites: [{ fn: 'f', seq: 1, call: 'this.x()', reason: 'no-receiver-type', plain: 'receiver type unknown', file: 'a.ts', line: 3 }] };
  const t = { start: { service: 'safer-auth' }, messages: [msg({ kind: 'entry' }), msg({ service: 'a', fn: 'f', seq: 1 })] };
  assert.deepEqual(traceBlocked(t, cov), { n: 3, source: 'coverage' });
  const w = blockedSites(t, cov);
  assert.equal(w.source, 'coverage');
  assert.equal(w.sites[0].service, 'safer-auth');
  assert.equal(w.more, 2, 'blocked 3, one listed');
  assert.deepEqual(traceBlocked(t, null), { n: 0, source: null }, 'no coverage either: no badge');
});

test('gap data on the trace wins over a different coverage count (the header corrects the list)', () => {
  const t = { start: { service: 's' }, messages: [msg({ kind: 'entry' }), blockedMsg('s', 'f', 1), blockedMsg('other', 'g', 2), blockedMsg('other', 'g', 3)] };
  assert.equal(traceBlocked(t, { status: 'incomplete', blocked: 1 }).n, 3);
  assert.equal(listBlocked({ blocked: 1 }), 1, 'the list reads coverage only');
});

test('status incomplete with blocked 0: incomplete, no count, nothing to list', () => {
  const cov = { status: 'incomplete' as const, blocked: 0 };
  assert.equal(listIncomplete(cov), true);
  assert.equal(listBlocked(cov), 0);
  assert.equal(blockedSites({ messages: [msg({ kind: 'entry' })] }, cov).sites.length, 0);
  assert.equal(listIncomplete({ status: 'complete', blocked: 0 }), false);
  assert.equal(listIncomplete(null), false);
  assert.equal(T.badgeText(0), 'incomplete');
});

test('coverage cap: more than 20 coverage sites list 20 and say how many more', () => {
  const sites = Array.from({ length: 25 }, (_, i) => ({ fn: 'f', seq: i + 1 }));
  const w = blockedSites({ start: { service: 's' }, messages: [msg({ kind: 'entry' })] }, { blocked: 25, sites });
  assert.equal(w.sites.length, 20);
  assert.equal(w.more, 5);
});

test('coverageOf keeps what is well formed and drops the rest', () => {
  assert.equal(coverageOf({}), null);
  assert.equal(coverageOf({ coverage: 'yes' }), null);
  assert.deepEqual(coverageOf({ coverage: { status: 'bogus', blocked: -2, sites: [{ fn: 1 }, { fn: 'f', seq: 2, plain: 'p', junk: 1 }] } }), { sites: [{ fn: 'f', seq: 2, plain: 'p' }] });
});

// ---- the walker and the demo samples ----
test('safer-auth: the folded marker carries frontierBlocked 2 with both sites; coverage rides on the trace with repository links', () => {
  const m = folded.messages.find((x: any) => x.kind === 'frontier')!;
  assert.equal(m.frontierSteps, 6);
  assert.equal(m.frontierBlocked, 2);
  assert.deepEqual(m.frontierSites!.map((s) => s.plain), ['receiver type unknown', 'class not in this repository']);
  assert.equal(traceBlocked(folded, folded.coverage).n, 2);
  assert.equal(folded.coverage!.status, 'incomplete');
  assert.match(folded.coverage!.sites![0].url as string, /github\.com\/acme\/safer-auth\/blob\/[^/]+\/src\/auth\.service\.ts#L21$/);
});

test('safer-auth expanded: the same two steps are drawn and counted, never twice', () => {
  const blocked = open.messages.filter((x: any) => x.blocked);
  assert.deepEqual(blocked.map((x: any) => x.blocked.id), ['safer-auth:AuthService.isAuthenticated#1', 'safer-auth:AuthService.isAuthenticated#3']);
  assert.equal(open.messages.some((x: any) => x.kind === 'frontier'), false);
  assert.equal(traceBlocked(open, open.coverage).n, 2);
  const w = blockedSites(open, open.coverage);
  assert.equal(w.source, 'trace');
  assert.equal(w.sites[0].call, 'this.checkSecretIsValid(secret)');
  assert.equal(w.sites[0].file, 'src/auth.service.ts');
});

test('safer-lookup: gap: false only. No marker count, no N, coverage complete', () => {
  const t = trace(g, lookup, { scope: 'full', maxMessages: 800 })!;
  const m = t.messages.find((x: any) => x.kind === 'frontier')!;
  assert.equal(m.frontierBlocked, undefined);
  assert.equal(traceBlocked(t, t.coverage).n, 0);
  assert.equal(listIncomplete(t.coverage), false);
  const o = trace(g, lookup, { scope: 'full', frontier: true, maxMessages: 800 })!;
  assert.equal(o.messages.filter((x: any) => x.blocked).length, 0);
});

test('entry points carry coverage ({ status, blocked }) only where the ingress reports it', () => {
  const eps = entryPoints(g) as any[], by = (s: string) => eps.find((e) => e.service === s);
  assert.deepEqual(by('safer-auth').coverage, { status: 'incomplete', blocked: 2 });
  assert.deepEqual(by('safer-lookup').coverage, { status: 'complete', blocked: 0 });
  assert.ok(eps.filter((e) => !["safer-auth", "safer-lookup", "group-admin"].includes(e.service)).every((e) => e.coverage === undefined));
});

// ---- the lane and its geometry ----
test('lane: a blocked frontier step is an icall row marked blocked and taller than an ordinary one', () => {
  const lane = buildLane(open.messages, { participants: open.participants, icalls: false });
  const rows = lane.events.filter((e: any) => e.type === 'icall');
  assert.equal(rows.length, 6);
  assert.deepEqual(rows.filter(isBlockedEvent).map((e: any) => e.msg.blocked.seq), [1, 3]);
  const L = layoutLane(lane);
  const h = (e: any) => L.top[e.row + 1] - L.top[e.row];
  assert.ok(h(rows.find(isBlockedEvent)) > h(rows.find((e: any) => !isBlockedEvent(e))));
  assert.ok(L.width >= L.xs[L.xs.length - 1] + 56, 'the lane is wide enough for the blocked text');
});

test('lane: the folded marker is one frontier event that carries the counts', () => {
  const lane = buildLane(folded.messages, { participants: folded.participants });
  const f = lane.events.filter((e: any) => e.type === 'frontier');
  assert.equal(f.length, 1);
  assert.equal(T.frontierText(f[0].msg.frontierSteps, f[0].msg.frontierBlocked), 'frontier: 6 steps · 2 blocked');
});

// ---- the texts ----
test('texts: badge, tooltips, frontier label (M = 0, 1, many; K = 1), blocked line fallbacks', () => {
  assert.equal(T.badgeText(1), 'incomplete · 1 blocked');
  assert.equal(T.badgeText(12), 'incomplete · 12 blocked');
  assert.equal(T.badgeLabel(2, { button: true }), 'Incomplete: 2 blocked calls not followed. Show why incomplete');
  assert.equal(T.badgeLabel(1), 'Incomplete: 1 blocked call not followed');
  assert.match(T.listTip(2, 'safer-auth'), /^Incomplete flow\. 2 calls in safer-auth could not be followed/);
  assert.match(T.headTip(2, 'trace', 'safer-auth'), /across every service on this trace, folded frontier steps included\. Select to see why\.$/);
  assert.match(T.headTip(2, 'coverage', 'safer-auth'), /Counted for safer-auth only\. Select to see why\.$/);
  assert.equal(T.frontierText(6, 0), 'frontier: 6 steps');
  assert.equal(T.frontierText(1, 0), 'frontier: 1 step');
  assert.equal(T.frontierText(6, 1), 'frontier: 6 steps · 1 blocked');
  assert.equal(T.frontierText(6, 4), 'frontier: 6 steps · 4 blocked');
  assert.equal(T.blockedLine({ plain: 'receiver type unknown' }), 'blocked: receiver type unknown');
  assert.equal(T.blockedLine({ reason: 'no-receiver-type' }), 'blocked: no-receiver-type');
  assert.equal(T.blockedLine(undefined, undefined), 'blocked: target not resolved');
  assert.equal(T.siteTitle({ plain: 'receiver type unknown' }), 'Receiver type unknown');
  assert.equal(T.siteCode({ plain: 'x', reason: 'no-receiver-type' }), 'no-receiver-type');
  assert.equal(T.sitePlace({ file: 'a.ts', line: 3 }), 'a.ts:3');
  assert.equal(T.sitePlace({}), '');
  assert.equal(T.filterStatus(1, 88), '1 of 88 flows are incomplete');
});

test('Why incomplete groups by service only when the sites span more than one', () => {
  assert.equal(T.siteGroups([{ service: 'a' }, { service: 'a' }]).length, 1);
  assert.deepEqual(T.siteGroups([{ service: 'a' }, { service: 'b' }, { service: 'a' }]).map((x: any) => [x.service, x.sites.length]), [['a', 2], ['b', 1]]);
});

test('reserved: provenance.kind llm is the inferred style; nothing else is', () => {
  assert.equal(T.isInferred({ provenance: { kind: 'llm' } }), true);
  assert.equal(T.isInferred({ provenance: { verified: 'match' } }), false);
  assert.equal(T.isInferred({}), false);
  assert.equal(T.INFERRED_TAG, 'inferred (LLM)');
});

// ---- the Flows list filter ----
const pts = [
  { service: 'a', id: '1', bindKey: 'http:GET a/1', handler: 'h', coverage: { status: 'incomplete', blocked: 2 } },
  { service: 'a', id: '2', bindKey: 'http:GET a/2', handler: 'h', coverage: { status: 'complete', blocked: 0 } },
  { service: 'b', id: '3', bindKey: 'http:GET b/3', handler: 'h', coverage: { status: 'incomplete', blocked: 0 } },
  { service: 'b', id: '4', bindKey: 'http:GET b/4', handler: 'h' },
];
test('filter: only incomplete flows (a count or the status), ANDed with the text; the count ignores the filter', () => {
  assert.deepEqual(filterPoints(pts, { incomplete: true }).map((p: any) => p.id), ['1', '3']);
  assert.deepEqual(filterPoints(pts, { incomplete: true, q: 'b/' }).map((p: any) => p.id), ['3']);
  assert.equal(filterPoints(pts, {}).length, 4);
  assert.equal(incompleteCount(pts), 2);
  assert.equal(isIncompletePoint(pts[1]), false);
  assert.equal(isIncompletePoint(pts[3]), false);
});

test('filter: offered only where some flow has coverage; incomplete=1 is ignored elsewhere and round-trips', () => {
  assert.equal(hasCoverage(pts), true);
  assert.equal(hasCoverage([pts[3]]), false);
  const q = new URLSearchParams('incomplete=1');
  assert.equal(incompleteOn(q, true), true);
  assert.equal(incompleteOn(q, false), false);
  assert.equal(incompleteOn(new URLSearchParams(''), true), false);
  assert.equal(incompleteOn(new URLSearchParams('incomplete=0'), true), false);
  assert.equal(incompleteParam(true), '1');
  assert.equal(incompleteParam(false), null);
});

test('XSS: a harvester source.url that is not http(s) never becomes a link on a blocked site', async () => {
  const { stepBlocked } = await import('../core/incomplete.ts');
  const fake: any = { services: new Map([['s', { name: 's', repo: 'github.com/o/r' }]]), egress: new Map() };
  const st = (url: string): any => ({ seq: 1, type: 'call', unresolved: [{ what: 'target', reason: 'r', gap: true }], source: { file: 'a.ts', line: 3, url } });
  assert.equal(stepBlocked(fake, 's', 'f', st('javascript:alert(1)'))!.url, undefined);
  assert.equal(stepBlocked(fake, 's', 'f', st('https://example.com/x'))!.url, 'https://example.com/x');
});
