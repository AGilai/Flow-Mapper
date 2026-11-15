// Frame 28 (the Flows page's two rows, stage 1): the pure parts: the width levels, the tab row's plan, the View menu's count of changed options and its stored switches,
// the pinned heads rule (#107) and the popover's place. Wiring is read from the sources in flow-bars-view.test.ts (no DOM harness exists).
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import * as B from '../web/js/views/flow-bars-pure.js';
// @ts-ignore
import * as L from '../web/js/views/flow-levels.js';
// @ts-ignore
import * as V from '../web/js/views/flow-view-pure.js';

const mem = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, m }; };
const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };

test('the level of the main column: L0 from 1500, L1 from 1100, L2 from 760, below that L3; an unmeasured width is the widest', () => {
  assert.deepEqual([1900, 1500, 1499, 1100, 1099, 760, 759, 672, 300].map(L.levelOf), [0, 0, 1, 1, 2, 2, 3, 3, 3]);
  assert.equal(L.levelOf(0), 0); assert.equal(L.levelOf(NaN), 0);
});

test('the active tab shows its entry id only at L0 with up to 4 tabs', () => {
  assert.equal(L.activeShowsId(0, 4), true); assert.equal(L.activeShowsId(0, 5), false); assert.equal(L.activeShowsId(1, 1), false); assert.equal(L.activeShowsId(3, 1), false);
});

test('a short id tail keeps the last dot segment; tabs of one service are the ones that need it', () => {
  assert.equal(L.shortTail('in.get.products'), '.products'); assert.equal(L.shortTail('in.events.order-created'), '.order-created');
  assert.equal(L.shortTail('plain'), 'plain'); assert.equal(L.shortTail('in.a.a-very-long-handler-name-here'), '.a-very-long-hand…');
  assert.deepEqual([...L.sharedTitles(['catalog-svc', 'orders-svc', 'catalog-svc', 'search-svc'])], ['catalog-svc']);
});

test('planTabs: as many as fit, in order; the active tab always stays, swapped in for the last one; at least one tab, however narrow', () => {
  const widths = [150, 150, 150, 150, 150, 150, 150, 150]; // 8 tabs, 2px gaps
  assert.deepEqual(L.planTabs({ widths, avail: 2000, active: 0 }), [0, 1, 2, 3, 4, 5, 6, 7], 'all fit');
  assert.deepEqual(L.planTabs({ widths, avail: 1000, active: 0 }), [0, 1, 2, 3, 4, 5], '6 x 150 + 5 x 2 = 910');
  assert.deepEqual(L.planTabs({ widths, avail: 1000, active: 7 }), [0, 1, 2, 3, 4, 7], 'the active tab 7 takes the last place, never the menu');
  assert.deepEqual(L.planTabs({ widths, avail: 10, active: 5 }), [5], 'nothing fits: the active one alone');
  assert.deepEqual(L.planTabs({ widths: [], avail: 100 }), []);
  assert.deepEqual(L.planTabs({ widths: [100, 300, 100], avail: 250, active: 1 }), [1], 'a wide active tab pushes the others out');
  for (let a = 0; a < 8; a++) assert.ok(L.planTabs({ widths, avail: 500, active: a }).includes(a), `active ${a} is visible`);
});

test('the "more" label: "N more", only the number at L3', () => {
  assert.equal(L.moreLabel(5, 0), '5 more'); assert.equal(L.moreLabel(2, 2), '2 more'); assert.equal(L.moreLabel(5, 3), '5');
});

const base = { bands: true, stores: true, frontier: false, merge: true, squeeze: true, hints: false, hintsDefault: false, depth: 'all', sb: 'tad', sd: 't', sdDefault: 't', size: 1, hideText: false, caption: true, legend: true };

test('View count: nothing at the defaults; each changed option counts once; "Group by subsystem" only where the environment has subsystems', () => {
  assert.deepEqual(V.nonDefault(base), []);
  assert.deepEqual(V.nonDefault({ ...base, bands: false, stores: false, frontier: true, merge: false, squeeze: false }), ['Group by subsystem', 'Data stores', 'Frontier', 'One arrow per target', 'Squeeze']);
  assert.deepEqual(V.nonDefault({ ...base, bands: null }), [], 'no subsystems: the switch is not offered, so it never differs');
  assert.deepEqual(V.nonDefault({ ...base, depth: '3', size: 3, hideText: true, caption: false, legend: false }), ['Depth', 'Text size', 'Hide text', 'Call notes', 'Legend']);
  assert.deepEqual(V.nonDefault({ ...base, sb: 'ta' }), ['Step details']); assert.deepEqual(V.nonDefault({ ...base, sd: 'a' }), ['Step details']);
});

test('Transport hints differ from the environment kind\'s default (off in a design, on in a harvested one), not from "off"', () => {
  assert.deepEqual(V.nonDefault({ ...base, hints: true, hintsDefault: false }), ['Transport hints']);
  assert.deepEqual(V.nonDefault({ ...base, hints: true, hintsDefault: true }), []);
  assert.deepEqual(V.nonDefault({ ...base, hints: false, hintsDefault: true }), ['Transport hints']);
});

test('the caption bar and the legend are on unless stored "0"; broken storage means on; the keys are flow-mapper.flow-caption and flow-mapper.flow-legend', () => {
  const st = mem();
  assert.equal(V.captionOn(st), true); assert.equal(V.legendOn(st), true);
  V.captionSave(false, st); V.legendSave(false, st);
  assert.equal(st.m.get('flow-mapper.flow-caption'), '0'); assert.equal(st.m.get('flow-mapper.flow-legend'), '0');
  assert.equal(V.captionOn(st), false); assert.equal(V.legendOn(st), false);
  V.captionSave(true, st); assert.equal(V.captionOn(st), true);
  assert.equal(V.captionOn(broken as any), true); assert.doesNotThrow(() => V.legendSave(false, broken as any));
});

test('#107 a head goes loose only when zoomed in and taller than 80% of the view: a normal head on a short scroller stays pinned', () => {
  assert.equal(B.looseHead({ headH: 182, viewH: 260, zoom: 1 }), false, 'the bug: 182 of 260 made the old 35% line scroll the head away');
  assert.equal(B.looseHead({ headH: 250, viewH: 260, zoom: 1 }), false, 'normal zoom is never loose');
  assert.equal(B.looseHead({ headH: 220, viewH: 300, zoom: 1.5 }), false, '80px of diagram left is enough');
  assert.equal(B.looseHead({ headH: 221, viewH: 300, zoom: 1.5 }), true);
  assert.equal(B.looseHead({ headH: 400, viewH: 300, zoom: 0.5 }), false, 'zoomed out: pinned');
  assert.equal(B.looseHead({ headH: 400, viewH: 300 }), false, 'no zoom given: pinned');
});

test('a popover sits under its button, right edges level, inside the window', () => {
  const rect = { bottom: 40, right: 700 };
  assert.deepEqual(B.popPlace({ rect, vw: 1280, vh: 800, max: 340, gap: 6 }), { top: 46, right: 580, width: 340, maxHeight: 746 });
  assert.equal(B.popPlace({ rect: { bottom: 40, right: 100 }, vw: 1280, vh: 800, max: 340 }).right, 932, 'a button near the left edge: the popover stays inside (1280 - 340 - 8)');
  assert.equal(B.popPlace({ rect, vw: 300, vh: 800, max: 340 }).width, 284, 'narrow window: window width less the margins');
});
