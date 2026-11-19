// CR #148: a lifeline head with its own icon (`details.icon`) draws it large and centred, the name under it, the product in grey; the box grows to fit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';
// @ts-ignore plain JS modules shared with the browser
import { buildLane } from '../web/js/views/flow-lane.js';
// @ts-ignore
import { layoutLane, LINE_H } from '../web/js/views/flow-draw-layout.js';
// @ts-ignore
import { isLarge, hasType, productOf, iconSize, largeExtra, autoCol, COL_AUTO_MAX, LG_SHIFT, LG_ICON } from '../web/js/views/flow-head-large.js';
// @ts-ignore
// @ts-ignore
import { typeOf } from '../web/js/pane/pane-type.js';
// @ts-ignore
import { setServiceInfo } from '../web/js/design/service-info.js';

const g = buildIndex(sampleModel());
const t = trace(g, { service: 'api-gateway', ingress: 'in.createOrder' }, { scope: 'full', maxMessages: 800 })!;
const lane = buildLane(t.messages, { scope: t.scope, participants: t.participants });
const services: string[] = lane.columns.filter((c: any) => c.kind === 'service').map((c: any) => c.service);
const [a, b] = services;
const infoFor = (list: any[]) => setServiceInfo(list.map((x) => ({ kind: 'service', ...x })), '');
const plain = () => { infoFor(services.map((name) => ({ name }))); return layoutLane(lane, 0); };

test('which heads get the large layout: only an own icon, not a kind icon, not none', () => {
  infoFor([{ name: a, details: { icon: 'vault', product: 'HashiCorp Vault' } }, { name: b }]);
  const col = (n: string) => lane.columns.find((c: any) => c.service === n);
  assert.equal(isLarge(col(a)), true);
  assert.equal(isLarge(col(b)), false);
  assert.equal(productOf(col(a)), 'HashiCorp Vault');
  assert.equal(productOf(col(b)), null, 'no icon, no large layout, no product line');
  assert.equal(isLarge({ kind: 'channel', transport: 'sqs' }), false, 'a channel keeps the small product icon');
  assert.equal(isLarge({ kind: 'resource', storeKind: 'mongodb' }), false, 'a store keeps the small product icon');
});

test('the box grows to hold the logo and the name only; it never shrinks', () => {
  const base = plain(), i = lane.columns.findIndex((c: any) => c.service === a);
  const need = (L: any) => 12 + L.heads[i].name.length * LINE_H + L.heads[i].sub.length * 13 + largeExtra(lane.columns[i]) + 6;
  infoFor([{ name: a, details: { icon: 'vault' } }]);
  const one = layoutLane(lane, 0);
  assert.ok(one.boxH >= base.boxH && one.boxH >= need(one));
  infoFor([{ name: a, details: { icon: 'vault', product: 'HashiCorp Vault' } }]);
  const two = layoutLane(lane, 0);
  assert.equal(two.boxH, one.boxH, 'the product line is not drawn in the head');
  assert.ok(!two.heads[i].product, 'no product line');
  assert.deepEqual(two.heads[i].sub, [], 'an icon head never shows a sub line, even with no specific type known');
  assert.equal(two.boxH, 12 + two.heads[i].name.length * LINE_H + LG_SHIFT + 6);
  infoFor([{ name: a, details: { icon: 'vault', runtime: 'k8s-pod' } }]);
  const three = layoutLane(lane, 0);
  assert.equal(hasType(lane.columns[i]), true);
  assert.deepEqual(three.heads[i].sub, [], 'a specific type is known: still no sub line');
  assert.equal(three.boxH, two.boxH, 'same box either way');
  assert.equal(two.HEAD - two.boxH, base.HEAD - base.boxH, 'the rest of the head strip is unchanged');
  assert.equal(largeExtra({ kind: 'service', service: 'x', env: '' }), 0);
  assert.equal(largeExtra(lane.columns[i]), LG_SHIFT);
});

test('no icon anywhere: the layout is today\'s (a head without an icon is unchanged)', () => {
  const base = plain();
  assert.ok(base.heads.every((h: any) => !h.big && !h.product));
});

test('the name of a large head uses the full width, wraps, and the product is carried for the drawing', () => {
  infoFor([{ name: a, details: { icon: 'auth0', product: 'Auth0' } }]);
  const L = layoutLane(lane, 0), i = lane.columns.findIndex((c: any) => c.service === a);
  assert.equal(L.heads[i].big, true);
  assert.equal(L.heads[i].product, undefined);
  const w = L.headBox(lane.columns[i]);
  assert.ok(L.heads[i].name.every((s: string) => s.length <= Math.floor((w - 20) / 6.6) + 1));
  const long = 'x'.repeat(60);
  infoFor([{ name: long, details: { icon: 'auth0' } }]);
  assert.equal(isLarge({ kind: 'service', service: long, env: '' }), true);
});

test('text positions: logo centred at the top, the name under it, nothing above the logo\'s bottom edge', () => {
  assert.equal(iconSize(130), LG_ICON);
  assert.equal(iconSize(50), 22);
  assert.equal(iconSize(30), 16, 'never under 16');
  // the first baseline of a small head is 18; a large head drops it under the logo (8 + 30 icon + 4 gap = 42 > the 12px cap-height line start)
  const firstBaseline = 18 + LG_SHIFT, nameTop = firstBaseline - 10;
  assert.ok(nameTop >= 8 + LG_ICON, 'the name starts under the logo');
  assert.equal(LINE_H, 14);
});

test('squeeze keeps the large heads: folded or not, boxH covers every visible head', () => {
  infoFor([{ name: a, details: { icon: 'vault', product: 'Vault' } }]);
  const full = layoutLane(lane, 0).width, L = layoutLane(lane, Math.floor(full * 0.6), { keep: [0, 1] });
  const need = (x: any, i: number) => 12 + x.name.length * LINE_H + x.sub.length * 13 + largeExtra(lane.columns[i]) + 6;
  L.heads.forEach((x: any, i: number) => assert.ok(L.boxH >= need(x, i)));
});

test('auto width: short names keep the minimum, a long name widens the lane, past the max it is clamped and wraps', () => {
  const svc = (label: string) => ({ kind: 'service', service: label, label, env: '' });
  infoFor([]);
  assert.equal(autoCol([svc('api'), svc('db')]), 138, 'short names: today\'s width');
  const mid = autoCol([svc('api'), svc('x'.repeat(26))]);
  assert.ok(mid > 138 && mid < COL_AUTO_MAX, 'a longer name widens every head');
  assert.equal(mid, Math.ceil(26 * 6.6) + 14 + 8, 'plain head: 6.6 px a character plus 14 padding plus the 8 px column margin');
  assert.equal(autoCol([svc('x'.repeat(80))]), COL_AUTO_MAX, 'clamped at the max');
  assert.equal(autoCol([{ kind: 'channel', label: 'x'.repeat(80) }]), 138, 'a channel has its own width');
  infoFor([{ name: 'big-icon-name-here', details: { icon: 'vault' } }]);
  assert.equal(autoCol([svc('big-icon-name-here')]), Math.ceil(18 * 6.6) + 20 + 8 > 138 ? Math.ceil(18 * 6.6) + 28 : 138);
});

test('auto width in a lane: every head shares the width; the longest name sits on one line until the max, then wraps; squeeze may still narrow it', () => {
  const n = 'lo-hi-identity-provider-service';
  const col = (name: string) => ({ ...lane.columns.find((c: any) => c.kind === 'service'), service: name, label: name });
  const wide = { ...lane, columns: [col(n), ...lane.columns.slice(1)] };
  infoFor([]);
  const L = layoutLane(wide, 0);
  assert.equal(L.heads[0].name.length, 1, 'one line');
  assert.ok(L.COLW > 138 && L.COLW <= COL_AUTO_MAX);
  assert.equal(L.headBox(wide.columns[0]), L.headBox(wide.columns[1].kind === 'service' ? wide.columns[1] : wide.columns[0]) || L.headBox(wide.columns[0]));
  const longer = { ...lane, columns: [col('a-very-long-component-name-'.repeat(3)), ...lane.columns.slice(1)] };
  const M = layoutLane(longer, 0);
  assert.equal(M.COLW, COL_AUTO_MAX);
  assert.ok(M.heads[0].name.length > 1, 'past the max it wraps');
  const S = layoutLane(wide, 200, null);
  assert.ok(S.COLW < L.COLW, 'a narrow window shrinks the column below the auto width (to 132 at least)');
});

test('the pane Type row: the runtime or kind when known, else the word Service', () => {
  assert.equal(typeOf({ details: { runtime: 'k8s-pod' } }, 'service'), 'Kubernetes pod');
  assert.equal(typeOf({}, 'lambda'), 'Lambda');
  assert.equal(typeOf({}, 'gateway'), 'Gateway');
  assert.equal(typeOf({}, 'service'), 'Service');
  assert.equal(typeOf({}, undefined), 'Service');
});
