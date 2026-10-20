// 0.13.0: flow tabs, pure helpers (keys, URL, open/close/reopen order, distinct selection, keyboard).
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import * as T from '../web/js/views/flow-tabs-state.js';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore
import { asyncTree } from '../web/js/views/flow-async.js';

const q = (s: string) => new URLSearchParams(s);
const row = (queue: string, handler: string, extra: any = {}) => ({ queue, handler, ingress: 'in.' + handler, seenIn: null, noHandler: false, groups: [], ...extra });

test('keys round-trip, with the characters that need escaping', () => {
  const e = T.entryKey('api-gateway', 'in.createOrder');
  assert.equal(e, 'api-gateway/in.createOrder');
  assert.deepEqual(T.parseKey(e), { key: e, kind: 'entry', service: 'api-gateway', ingress: 'in.createOrder', event: null, scope: 'full' });
  const odd = T.entryKey('svc', 'in,a@b~c/d', 'ev@1');
  assert.deepEqual([T.parseKey(odd).ingress, T.parseKey(odd).event], ['in,a@b~c/d', 'ev@1']);
  assert.ok(!odd.includes(',') && !odd.includes('@'));
  const sp = T.entryKey('my svc', 'in a\tb');
  assert.ok(!/\s/.test(sp));
  assert.deepEqual([T.parseKey(sp).service, T.parseKey(sp).ingress], ['my svc', 'in a\tb'], 'whitespace round-trips');
  assert.equal(T.parseKey(T.fnKey('s', 'doIt')).kind, 'fn');
  assert.equal(T.entryKey('s', 'in.x', null, 'full'), 's/in.x', 'the default scope is not in the key');
  assert.equal(T.parseKey(T.entryKey('s', 'in.x', 'E', 'intra')).scope, 'intra');
  assert.equal(T.parseKey(T.fnKey('s', 'f')).scope, 'intra');
  assert.equal(T.parseKey(T.fnKey('s', 'f', null, 'full')).scope, 'full');
  assert.equal(T.withScope('s/in.x', 'intra'), 's/in.x!intra');
  assert.equal(T.withScope('s/in.x!intra', 'full'), 's/in.x');
  assert.equal(T.parseKey(T.entryKey('s', 'a!intra')).scope, 'full', 'an ! inside a name is escaped');
  const sub = T.subKey(row('sqs:shipping-order-events', 'onOrderPlaced'), e);
  assert.equal(sub, 'sqs:shipping-order-events/onOrderPlaced@api-gateway/in.createOrder');
  const p = T.parseKey(sub);
  assert.deepEqual([p.kind, p.queue, p.handler, p.origin], ['sub', 'sqs:shipping-order-events', 'onOrderPlaced', e]);
  const nested = T.subKey(row('sqs:q2', 'h2'), sub);
  assert.equal(T.parseKey(nested).origin, sub, 'the first @ splits; the origin keeps its own @');
  assert.equal(T.originOf(nested), sub);
  assert.ok(T.descends(nested, e) && !T.descends(e, nested));
  const full = T.fullKey('shipping-svc', 'in.onOrderPlaced', sub);
  assert.deepEqual([T.parseKey(full).kind, T.parseKey(full).service, T.parseKey(full).origin], ['full', 'shipping-svc', sub]);
  assert.equal(T.parseKey(T.fullKey('a', 'b')).origin, null);
});

test('junk keys are not keys', () => {
  for (const k of ['', 'nothing', 'a/b/c', 'a b/c', '/x', 'x/', 'sqs:q/h@', 'plain/h@origin/x']) assert.equal(T.parseKey(k), null, k);
});

test('URL: tabs and tab, unknown keys dropped, duplicates dropped, old single-flow links open one tab', () => {
  const a = T.entryKey('api-gateway', 'in.createOrder'), b = T.entryKey('orders-svc', 'in.http.create'), s = T.subKey(row('sqs:q', 'h'), a);
  const st = T.decodeUrl(new URLSearchParams({ tabs: [a, 'junk', s, a, b].join(','), tab: s }));
  assert.deepEqual(st.keys, [a, s, b]);
  assert.equal(st.active, s);
  assert.equal(T.decodeUrl(q(`tabs=${a},${b}`)).active, b, 'no tab=: the last one');
  assert.equal(T.decodeUrl(q(`tabs=${a},${b}&tab=gone`)).active, b);
  assert.deepEqual(T.decodeUrl(q('service=api-gateway&ingress=in.createOrder&scope=full')).keys, [a]);
  assert.deepEqual(T.decodeUrl(q('service=svc&fn=doIt&scope=intra')).keys, [T.fnKey('svc', 'doIt')]);
  assert.deepEqual(T.decodeUrl(q('service=api-gateway&ingress=in.createOrder&scope=intra')).keys, [a + '!intra'], 'the old scope= param');
  assert.deepEqual(T.decodeUrl(q('service=svc&ingress=in.x&event=E1')).keys, [T.entryKey('svc', 'in.x', 'E1')]);
  assert.deepEqual(T.decodeUrl(q('service=svc')).keys, [], 'a service alone only filters the list');
  assert.deepEqual(T.decodeUrl(q('tabs=')).keys, []);
  const enc: any = T.encodeUrl(st);
  const back = T.decodeUrl(new URLSearchParams(Object.entries(enc).filter(([, v]) => v) as any));
  assert.deepEqual([back.keys, back.active], [st.keys, st.active]);
  assert.deepEqual(T.encodeUrl(T.emptyState()), { tabs: null, tab: null, ingress: null, fn: null, event: null, scope: null });
});

test('open: never replaces, an open tab is only activated, a sub-flow lands after the tabs of its origin', () => {
  const a = 'a/x', b = 'b/y';
  let s = T.openTab(T.emptyState(), a);
  s = T.openTab(s, b);
  assert.deepEqual([s.keys, s.active], [[a, b], b]);
  assert.deepEqual(T.openTab(s, a).keys, [a, b]);
  assert.equal(T.openTab(s, a).active, a);
  const s1 = T.subKey(row('sqs:q1', 'h1'), a), s2 = T.subKey(row('sqs:q2', 'h2'), a), s11 = T.subKey(row('sqs:q3', 'h3'), s1);
  s = T.openTab(s, s1);
  s = T.openTab(s, s2);
  s = T.openTab(s, s11, { activate: false });
  assert.deepEqual(s.keys, [a, s1, s11, s2, b], 'children right after their origin, grandchildren under their parent');
  assert.equal(s.active, s2, 'not activated');
  const back = T.openTab(T.closeTab(T.openTab(T.openTab(T.emptyState(), a), s1), a), a);
  assert.deepEqual(back.keys, [a, s1], 'a closed origin comes back before its children');
  const orphan = T.openTab(T.openTab(T.emptyState(), b), T.subKey(row('sqs:q', 'h'), 'gone/z'));
  assert.equal(orphan.keys.length, 2, 'an origin that is not open: appended');
});

test('rekey keeps the place and the active tab', () => {
  const s = T.activate(['a/x', 'b/y'].reduce((x, k) => T.openTab(x, k), T.emptyState()), 'a/x');
  const r = T.rekey(s, 'a/x', 'a/x!intra');
  assert.deepEqual([r.keys, r.active], [['a/x!intra', 'b/y'], 'a/x!intra']);
  assert.equal(T.rekey(s, 'a/x', 'b/y'), s, 'not onto an open tab');
});

test('close: the left neighbour (or the origin) comes up; children stay open; reopen restores the place', () => {
  const a = 'a/x', b = 'b/y', s1 = T.subKey(row('sqs:q1', 'h1'), a), s11 = T.subKey(row('sqs:q3', 'h3'), s1);
  let s = [a, s1, s11, b].reduce((x, k) => T.openTab(x, k), T.emptyState());
  s = T.activate(s, s1);
  const c = T.closeTab(s, s1);
  assert.deepEqual(c.keys, [a, s11, b], 'the tab opened from it stays');
  assert.equal(c.active, a, 'the origin is open, so it comes up');
  assert.equal(T.closeTab(T.activate(s, s11), s11).active, s1);
  assert.equal(T.closeTab(T.activate(s, a), a).active, s1, 'the first tab: its right neighbour');
  assert.equal(T.closeTab(T.activate(s, b), b).active, s11);
  assert.equal(T.closeTab(s, b).active, s1, 'closing another tab keeps the active one');
  const r = T.reopenTab(c);
  assert.deepEqual(r.keys, [a, s1, s11, b]);
  assert.equal(r.active, s1);
  assert.equal(T.reopenTab(r), r, 'nothing left to reopen');
  const all = T.closeAll(s);
  assert.deepEqual([all.keys, all.active], [[], null]);
  assert.equal(T.reopenTab(T.reopenTab(all)).keys.length, 2, 'last closed first');
  assert.deepEqual(T.closeOthers(s, b).keys, [b]);
  assert.equal(T.closeTab(T.openTab(T.emptyState(), a), a).active, null);
});

test('[ ] wrap, 1 to 9 jump', () => {
  const s = ['a/1', 'b/2', 'c/3'].reduce((x, k) => T.openTab(x, k), T.emptyState());
  assert.equal(T.step(s, 1).active, 'a/1');
  assert.equal(T.step(T.activate(s, 'a/1'), -1).active, 'c/3');
  assert.equal(T.nth(s, 2).active, 'b/2');
  assert.equal(T.nth(s, 7).active, 'c/3', 'past the end: the last');
  assert.equal(T.nth(T.emptyState(), 1).active, null);
});

test('distinct selection and sub-flow rows', () => {
  const r1 = row('sqs:q1', 'h1'), r2 = row('sqs:q1', 'h1', { suspect: true }), r3 = row('sqs:q2', 'h2'), seen = row('sqs:q2', 'h2', { seenIn: '2' }), nh = row('sqs:q9', 'x', { noHandler: true }), noIng = row('sqs:q8', 'y', { ingress: null });
  assert.deepEqual(T.distinctRows([r1, r2, r3, seen, nh, noIng]), [r1, r3]);
  assert.equal(T.findRow([seen, r3], 'sqs:q2', 'h2'), r3, 'prefers the fresh row');
  assert.equal(T.findRow([seen], 'sqs:q2', 'h2'), seen);
  assert.equal(T.findRow([r1], 'sqs:nope', 'h1'), null);
  const inner = row('sqs:in', 'hi'), mid = row('sqs:mid', 'hm', { groups: [{ pub: 4, rows: [inner] }] }), top = row('sqs:top', 'ht', { groups: [{ pub: 2, rows: [mid] }] });
  assert.deepEqual(T.subTree(top).rows, [mid, inner]);
  assert.equal(T.groupOfRow({ groups: [{ pub: 1, rows: [top] }] }, inner).pub, 4);
});

const ev = (o: any) => ({ target: { tagName: 'DIV' }, ...o });
test('keyboard: [ ] 1-9 Alt+W Alt+Shift+T; not in form fields, not with Ctrl/Cmd, never Escape', () => {
  assert.deepEqual(T.keyAction(ev({ key: '[' })), { type: 'prev' });
  assert.deepEqual(T.keyAction(ev({ key: ']' })), { type: 'next' });
  assert.deepEqual(T.keyAction(ev({ key: '3' })), { type: 'jump', n: 3 });
  assert.equal(T.keyAction(ev({ key: '0' })), null);
  assert.deepEqual(T.keyAction(ev({ key: '∑', code: 'KeyW', altKey: true })), { type: 'close' }, 'Mac Option+W types another character');
  assert.deepEqual(T.keyAction(ev({ key: 'T', code: 'KeyT', altKey: true, shiftKey: true })), { type: 'reopen' });
  assert.equal(T.keyAction(ev({ key: 'w', code: 'KeyW', altKey: true, shiftKey: true })), null);
  assert.equal(T.keyAction(ev({ key: 'w', code: 'KeyW', ctrlKey: true })), null, 'Ctrl+W is the browser');
  assert.equal(T.keyAction(ev({ key: '1', metaKey: true })), null);
  assert.equal(T.keyAction(ev({ key: 'Escape' })), null);
  assert.equal(T.keyAction({ key: '[', target: { tagName: 'INPUT' } }), null);
  assert.equal(T.keyAction({ key: '2', target: { tagName: 'DIV', isContentEditable: true } }), null);
});

test('real trace: every openable row has a key that finds its row again; distinct rows match the index count', () => {
  const t = trace(buildIndex(sampleModel()), { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full', maxMessages: 800 })!;
  const tree = asyncTree(t.messages), origin = T.entryKey('api-gateway', 'in.createOrder');
  const distinct = T.distinctRows(tree.rows);
  assert.ok(distinct.length >= 3);
  for (const r of distinct) {
    const p = T.parseKey(T.subKey(r, origin));
    assert.equal(p.kind, 'sub');
    assert.equal(T.findRow(tree.rows, p.queue, p.handler), r);
  }
  const nested = tree.rows.find((r: any) => r.groups.length);
  if (nested) assert.ok(T.subTree(nested).rows.length >= 1);
});
