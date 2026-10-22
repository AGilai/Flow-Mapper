// 0.30.3 (#69) zoom of the flow diagram: the pure parts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { clampZoom, clampRange, decodeZoom, encodeZoom, parseTyped, fitScale, scaleOf, percentOf, stepZoom, anchorDelta, wheelFactor } from '../web/js/views/flow-zoom-pure.js';

const q = (s: string) => new URLSearchParams(s);

test('zoom is clamped to 25..400 and rounded', () => {
  assert.equal(clampZoom(10), 25);
  assert.equal(clampZoom(900), 400);
  assert.equal(clampZoom(149.6), 150);
  assert.equal(clampZoom('abc'), 100);
  assert.equal(clampRange(10), 25);
  assert.equal(clampRange(133.3), 133.3);
});

test('zoom= in the URL: percent, fit, nothing at 100', () => {
  assert.equal(decodeZoom(q('zoom=150')), 150);
  assert.equal(decodeZoom(q('zoom=fit')), 'fit');
  assert.equal(decodeZoom(q('zoom=5')), 25);
  assert.equal(decodeZoom(q('zoom=9999')), 400);
  assert.equal(decodeZoom(q('zoom=x')), null);
  assert.equal(decodeZoom(q('')), null);
  assert.equal(encodeZoom(100), null);
  assert.equal(encodeZoom(null), null);
  assert.equal(encodeZoom(150), '150');
  assert.equal(encodeZoom(99.7), null);
  assert.equal(encodeZoom('fit'), 'fit');
  assert.equal(encodeZoom(1000), '400');
});

test('the % box: digits with or without %, clamped, anything else is refused', () => {
  assert.equal(parseTyped('150'), 150);
  assert.equal(parseTyped(' 80 % '), 80);
  assert.equal(parseTyped('1000%'), 400);
  assert.equal(parseTyped('3'), 25);
  assert.equal(parseTyped(''), null);
  assert.equal(parseTyped('abc'), null);
  assert.equal(parseTyped('-5'), null);
});

test('Fit: the width of a tall diagram, the whole of a short one', () => {
  // wide and tall: fit the width (it scrolls down)
  assert.equal(fitScale({ w: 2000, h: 3000, vw: 1000, vh: 600 }), 0.5);
  // short and narrower than the window: shown whole and enlarged to fill it, up to 200%
  assert.equal(fitScale({ w: 500, h: 200, vw: 1000, vh: 600 }), 2);
  assert.equal(fitScale({ w: 400, h: 100, vw: 1600, vh: 600 }), 2);
  assert.equal(fitScale({ w: 800, h: 300, vw: 1000, vh: 600 }), 1.25);
  // short but its width is the limit: the width scale is also the smaller one
  assert.equal(fitScale({ w: 2000, h: 300, vw: 1000, vh: 600 }), 0.5);
  assert.equal(fitScale({ w: 400, h: 500, vw: 1600, vh: 600 }), 1.2);
  // a tall diagram still fits its width, even when that enlarges it
  assert.equal(fitScale({ w: 500, h: 900, vw: 1000, vh: 600 }), 2);
  // clamped to the range
  assert.equal(fitScale({ w: 100000, h: 10, vw: 1000, vh: 600 }), 0.25);
  assert.equal(fitScale({ w: 10, h: 1000, vw: 1000, vh: 600 }), 4);
  // nothing to measure yet
  assert.equal(fitScale({ w: 0, h: 10, vw: 1000, vh: 600 }), null);
  assert.equal(fitScale({ w: 100, h: 10, vw: 0, vh: 600 }), null);
});

test('scale of a zoom value and the percent shown', () => {
  assert.equal(scaleOf(150), 1.5);
  assert.equal(scaleOf('fit', 0.62), 0.62);
  assert.equal(scaleOf('fit', null), 1);
  assert.equal(percentOf(0.624), 62);
});

test('- and + move by 10 below 100 and by 25 from 100 up, and stop at the ends', () => {
  assert.equal(stepZoom(100, 1), 125);
  assert.equal(stepZoom(120, 1), 125);
  assert.equal(stepZoom(125, 1), 150);
  assert.equal(stepZoom(100, -1), 90);
  assert.equal(stepZoom(120, -1), 100);
  assert.equal(stepZoom(90, 1), 100);
  assert.equal(stepZoom(35, -1), 30);
  assert.equal(stepZoom(25, -1), 25);
  assert.equal(stepZoom(400, 1), 400);
});

test('zoom around a point keeps the content under the pointer fixed', () => {
  // The diagram's left edge is at screen x = 100; the pointer is at 400, so it is over content x = 300 at scale 1.
  const origin0 = 100, at = 400, from = 1, to = 2;
  // At scale 2 content x = 300 sits 600 px from the diagram edge; the edge must be at 400 - 600 = -200, i.e. scroll by 300.
  const delta = anchorDelta({ origin0, origin1: origin0, at, from, to }); // the edge has not moved yet: how far to scroll
  assert.equal(delta, 300);
  // after scrolling by `delta` the edge is at origin1 - delta, and the point under the pointer is the same content
  const edge = origin0 - delta, content = (at - edge) / to;
  assert.equal(content, (at - origin0) / from);
  // zooming out is symmetric
  const back = anchorDelta({ origin0: edge, origin1: edge, at, from: to, to: from });
  assert.equal(edge - back, origin0);
  // same scale: nothing moves
  assert.equal(anchorDelta({ origin0: 5, origin1: 5, at: 77, from: 1.5, to: 1.5 }), 0);
});

test('the wheel: up zooms in, down zooms out, one event is bounded', () => {
  assert.ok(wheelFactor(-10) > 1);
  assert.ok(wheelFactor(10) < 1);
  assert.equal(wheelFactor(0), 1);
  assert.equal(wheelFactor(-5000), wheelFactor(-60));
  assert.ok(wheelFactor(-60) < 1.5);
  assert.equal(wheelFactor(-3, 1), wheelFactor(-48));
  assert.ok(Math.abs(wheelFactor(3) * wheelFactor(-3) - 1) < 1e-12);
});
