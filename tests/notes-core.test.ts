// 0.34.0: the pure part of Notes (core/notes.ts) and the notes mode of the sanitizer (core/rich-text.ts).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../core/rich-text.ts';
import { headings, stepRefs, parseStepRef, stepRefText, splitBlocks, diffBlocks, changesOnly, templateHtml, hasNotes } from '../core/notes.ts';

test('sanitizer notes mode: h1/h2 -> h2, h3..h6 -> h3, step chips with digits only; comments keep paragraphs and bare spans', () => {
  assert.equal(sanitize('<h1>A</h1><h3>B</h3><h6>C</h6>', { notes: true }), '<h2>A</h2><h3>B</h3><h3>C</h3>');
  assert.equal(sanitize('<h2>A</h2><p><span data-step="4">x</span> <span data-step="4-9">y</span> <span data-step="9-4">z</span> <span data-step="x1">w</span></p>', { notes: true }),
    '<h2>A</h2><p><span data-step="4">x</span> <span data-step="4-9">y</span> z w</p>');
  assert.equal(sanitize('<h2>A</h2><p><span data-step="4">x</span></p>'), '<p>A</p><p>x</p>', 'a comment has neither');
  assert.equal(sanitize('<h2 onclick="x()" class="big">Hi</h2>', { notes: true }), '<h2>Hi</h2>');
  assert.equal(sanitize('<h2><p>Title</p></h2><h3></h3><h2>x<ul><li>l</li></ul>', { notes: true }), '<h2>Title</h2><h2>x</h2><ul><li>l</li></ul>');
});

test('sanitizer notes mode is canonical: sanitize(sanitize(x)) === sanitize(x)', () => {
  for (const x of ['<h2>T<b>b</b></h2><table><tr><td><h3>in</h3></td></tr></table>', '<h1>a<h2>b<h3>c', '<p><span data-step="3"><span data-step="4">n</span></span></p>', '<ul><li><h2>x</h2></li></ul>', templateHtml()]) {
    const once = sanitize(x, { notes: true });
    assert.equal(sanitize(once, { notes: true }), once, x);
  }
});

test('outline, step chips, the template', () => {
  const html = '<h2>Purpose</h2><p>x <span data-step="2">step 2</span> <span data-step="4-9">steps 4-9</span></p><h3>Sub <b>part</b></h3><h2></h2>';
  assert.deepEqual(headings(html), [{ level: 2, text: 'Purpose' }, { level: 3, text: 'Sub part' }]);
  assert.deepEqual(stepRefs(html), [{ from: 2, to: 2 }, { from: 4, to: 9 }]);
  assert.deepEqual([parseStepRef('4'), parseStepRef('4-9'), parseStepRef('9-4'), parseStepRef('0'), parseStepRef('a')], [{ from: 4, to: 4 }, { from: 4, to: 9 }, null, null, null]);
  assert.deepEqual([stepRefText({ from: 4, to: 4 }), stepRefText({ from: 4, to: 9 })], ['step 4', 'steps 4–9']);
  assert.deepEqual(headings(templateHtml()).map((h) => h.text), ['Purpose', 'How it works', 'Decisions', 'Open questions']);
  assert.equal(hasNotes(''), false); assert.equal(hasNotes('<p><br></p>'), false); assert.equal(hasNotes('<p>a</p>'), true);
});

test('blocks and the block diff: same, removed, added; Changes keeps unchanged headings only as context', () => {
  const a = '<h2>One</h2><p>keep</p><h2>Two</h2><p>old text</p><ul><li>a</li></ul>', b = '<h2>One</h2><p>keep</p><h2>Two</h2><p>new text</p><ul><li>a</li></ul><p>extra</p>';
  assert.deepEqual(splitBlocks(a), ['<h2>One</h2>', '<p>keep</p>', '<h2>Two</h2>', '<p>old text</p>', '<ul><li>a</li></ul>']);
  assert.deepEqual(splitBlocks('stray <b>x</b><p>y</p>'), ['<p>stray <b>x</b></p><p>y</p>'], 'text outside a block rides with the next block');
  const ops = diffBlocks(a, b);
  assert.deepEqual(ops.map((o) => [o.op, o.html]), [['same', '<h2>One</h2>'], ['same', '<p>keep</p>'], ['same', '<h2>Two</h2>'], ['del', '<p>old text</p>'], ['add', '<p>new text</p>'], ['same', '<ul><li>a</li></ul>'], ['add', '<p>extra</p>']]);
  assert.deepEqual(changesOnly(ops).map((o) => o.op + ':' + o.html.slice(0, 8)), ['same:<h2>One<', 'same:<h2>Two<', 'del:<p>old t', 'add:<p>new t', 'add:<p>extra']);
  assert.deepEqual(diffBlocks('', '<p>x</p>').map((o) => o.op), ['add']);
  assert.ok(diffBlocks('<p><span data-step="2">a</span></p>', '<p><span data-step="3">a</span></p>').some((o) => o.op === 'add'), 'a moved chip is a change');
});
