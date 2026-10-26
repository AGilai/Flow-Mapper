// 0.45.0 (#91): the flow Info pill and banner, the shared text size, Hide text and the Markdown of the descriptions, as far as they are pure (no DOM harness exists):
// web/js/views/flow-info-pure.js. The Markdown is core/markdown-lite (the renderer of `about`).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { aboutHtml } from '../core/markdown-lite.ts';
// @ts-ignore plain JS module shared with the browser
import * as P from '../web/js/views/flow-info-pure.js';

/** A Storage stand-in. `broken`: every access throws (private window, blocked site data). */
const mem = (init: Record<string, string> = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, String(v)); }, m }; };
const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };

test('the pill text: "Info · N related", "Info" alone, "N related" alone, none; a viewer who can add still gets "Info"', () => {
  assert.equal(P.pillText(true, 2), 'Info · 2 related');
  assert.equal(P.pillText(true, 0), 'Info');
  assert.equal(P.pillText(false, 3), '3 related');
  assert.equal(P.pillText(false, 0), null);
  assert.equal(P.pillText(false, 0, true), 'Info');
  assert.equal(P.pillText(true, undefined as any), 'Info');
});

test('open or closed: the saved choice rules; with none, a flow with a description opens once (and is remembered as seen); no description stays closed', () => {
  const st = mem();
  assert.deepEqual(P.infoInitial('prod/a/i', false, st), { open: false, auto: false }, 'no description: closed, and not marked seen');
  assert.deepEqual(P.infoInitial('prod/a/i', true, st), { open: true, auto: true }, 'the first visit of a flow with a description');
  assert.deepEqual(P.infoInitial('prod/a/i', true, st), { open: false, auto: false }, 'the second visit: closed (nothing was chosen)');
  assert.deepEqual(P.infoInitial('prod/b/j', true, st), { open: true, auto: true }, 'another flow is a first visit of its own');
  assert.equal(P.infoChoice(st), null, 'the automatic open is not a saved choice');
  P.infoSave(true, st);
  assert.equal(st.m.get('flow-mapper.flowinfo'), '1');
  assert.deepEqual(P.infoInitial('prod/c/k', true, st), { open: true, auto: false }, 'the saved choice rules, for every flow');
  P.infoSave(false, st);
  assert.deepEqual(P.infoInitial('prod/d/l', true, st), { open: false, auto: false }, 'closed stays closed on a flow never seen');
});

test('the seen set is capped and survives a damaged value', () => {
  const st = mem({ 'flow-mapper.flowinfo-seen': '{not json' });
  assert.deepEqual([...P.seenSet(st)], []);
  assert.equal(P.infoInitial('k0', true, st).open, true);
  for (let i = 1; i < 600; i++) P.infoInitial(`k${i}`, true, st);
  assert.ok(P.seenSet(st).size <= 500);
  assert.ok(P.seenSet(st).has('k599') && !P.seenSet(st).has('k0'));
});

test('storage that throws: every default applies and nothing throws', () => {
  assert.equal(P.infoChoice(broken), null);
  assert.deepEqual(P.infoInitial('x', true, broken), { open: true, auto: true }, 'opens (once per page load) when nothing can be remembered');
  assert.doesNotThrow(() => { P.infoSave(true, broken); P.sizeSave(3, broken); P.textHiddenSave(true, broken); });
  assert.equal(P.sizeStored(broken), P.SIZE_DEFAULT);
  assert.equal(P.textHidden(broken), false);
  assert.equal(P.seenSet(broken).size, 0);
});

test('related rows: the first six, "Show N more", and a row whose note is open is toggled on its own', () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ id: `r${i}` }));
  assert.deepEqual([P.relSlice(items, false).shown.length, P.relSlice(items, false).more], [6, 3]);
  assert.deepEqual([P.relSlice(items, true).shown.length, P.relSlice(items, true).more], [9, 0]);
  assert.deepEqual(P.relSlice(items.slice(0, 6), false), { shown: items.slice(0, 6), more: 0 });
  let open = new Set<string>();
  open = P.toggled(open, 'r1'); open = P.toggled(open, 'r4');
  assert.deepEqual([...open].sort(), ['r1', 'r4'], 'several rows may be open');
  open = P.toggled(open, 'r1');
  assert.deepEqual([...open], ['r4']);
});

test('text size: five sizes, default 13px, bounds, persisted in flow-mapper.textSize, one key for both descriptions', () => {
  assert.deepEqual(P.SIZES, [12, 13, 15, 17, 19]); assert.equal(P.SIZES[P.SIZE_DEFAULT], 13);
  assert.equal(P.stepSize(0, -1), 0, 'A− stops at the smallest'); assert.equal(P.stepSize(4, 1), 4, 'A+ stops at the largest');
  assert.equal(P.stepSize(1, 1), 2); assert.equal(P.stepSize(1, -1), 0);
  assert.equal(P.sizeLabel(2), '15px'); assert.equal(P.sizeLabel(99), '19px');
  const st = mem();
  assert.equal(P.sizeStored(st), 1, 'nothing stored: the default');
  P.sizeSave(3, st); assert.equal(st.m.get('flow-mapper.textSize'), '3'); assert.equal(P.sizeStored(st), 3);
  P.sizeSave(40, st); assert.equal(P.sizeStored(st), 4, 'out of range is clamped');
  assert.equal(P.sizeStored(mem({ 'flow-mapper.textSize': 'big' })), 1, 'a garbage value is the default');
  // ONE size for both: the flow description (flow-head.js) and the step description (flow-stepbar.js) build their A− / A+ from the same shared control
  for (const f of ['flow-head.js', 'flow-stepbar.js']) assert.match(readFileSync(new URL(`../web/js/views/${f}`, import.meta.url), 'utf8'), /import \{ sizeControl \} from '\.\/flow-textsize\.js'/, f);
});

test('Hide text: stored as flow-mapper.stepText, shown by default', () => {
  const st = mem();
  assert.equal(P.textHidden(st), false);
  P.textHiddenSave(true, st); assert.equal(st.m.get('flow-mapper.stepText'), '0'); assert.equal(P.textHidden(st), true);
  P.textHiddenSave(false, st); assert.equal(P.textHidden(st), false);
});

test('Markdown in the flow and step descriptions: bold, italic, bullets, line breaks, http(s) links only', () => {
  const html = aboutHtml('**What it does:** reads the *tenant*.\nSecond line.\n\n- one\n- two\n\nSee [the guide](https://wiki.example.com/g) and [mail](mailto:a@b.c) and [x](javascript:alert(1)).');
  assert.match(html, /<strong>What it does:<\/strong>/); assert.match(html, /<em>tenant<\/em>/);
  assert.match(html, /<br>/, 'a line break inside a paragraph'); assert.match(html, /<ul><li>one<\/li><li>two<\/li><\/ul>/);
  assert.match(html, /<a href="https:\/\/wiki\.example\.com\/g"/, 'an https link is a link');
  assert.doesNotMatch(html, /javascript:/); assert.doesNotMatch(html, /mailto:/); assert.match(html, /mail/, 'a refused link keeps its text');
  assert.match(aboutHtml('[a](http://x.test/p)'), /<a href="http:\/\/x\.test\/p"/);
  assert.equal(aboutHtml('<script>alert(1)</script>').includes('<script'), false, 'raw HTML never passes');
});

test('both descriptions render through mdBlock (the editors keep showing the raw text)', () => {
  const desc = readFileSync(new URL('../web/js/views/flow-desc.js', import.meta.url), 'utf8'), bar = readFileSync(new URL('../web/js/views/flow-stepbar.js', import.meta.url), 'utf8');
  assert.match(desc, /mdBlock\(text\)/); assert.match(bar, /mdBlock\(t\.desc\)/);
  assert.match(desc, /<textarea|h\('textarea\.textarea'/, 'the editor is a textarea with the raw text');
});
