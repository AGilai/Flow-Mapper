// Table column widths in a document: `data-w` in the sanitizer (Notes only, whole percent 5..95) and the pure resize math.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitize } from '../core/rich-text.ts';
import { parseWidth, resizePair, toPercent } from '../core/col-width.ts';

const doc = (x: string) => sanitize(x, { notes: true });
const t = (w: string) => `<table><tbody><tr><td data-w="${w}">a</td><td>b</td></tr></tbody></table>`;

test('data-w: a whole percent 5..95 is kept in a document, on td and th, with colspan', () => {
  assert.equal(doc(t('30')), t('30'));
  assert.equal(doc(t('5')), t('5'));
  assert.equal(doc(t('95')), t('95'));
  assert.equal(doc('<table><tr><th data-w="40" colspan="2">a</th></tr></table>'), '<table><tr><th colspan="2" data-w="40">a</th></tr></table>');
  assert.equal(doc(doc(t('30'))), doc(t('30')));
});

test('data-w: out of range, not an integer, or any other value is dropped; a comment never keeps it', () => {
  const plain = '<table><tbody><tr><td>a</td><td>b</td></tr></tbody></table>';
  for (const v of ['4', '96', '0', '100', '-5', '30.5', '3e1', 'abc', '', '30%', '030x', ' ', '1 2']) assert.equal(doc(t(v)), plain, v);
  assert.equal(sanitize(t('30')), plain);
  assert.equal(doc('<table><tr><td data-w="30" style="width:90%" onclick="x">a</td></tr></table>'), '<table><tr><td data-w="30">a</td></tr></table>');
  assert.equal(doc('<p data-w="30">x</p>'), '<p>x</p>');
});

test('parseWidth', () => {
  assert.equal(parseWidth('30'), 30);
  assert.equal(parseWidth(' 7 '), 7);
  for (const v of [null, undefined, '', '4', '96', '1.5', 'x']) assert.equal(parseWidth(v), null);
});

test('resizePair keeps the sum, the minimum of 5 and rounds to whole percent', () => {
  assert.deepEqual(resizePair(30, 30, 10), [40, 20]);
  assert.deepEqual(resizePair(30, 30, -10.4), [20, 40]);
  assert.deepEqual(resizePair(30, 30, 100), [55, 5]);
  assert.deepEqual(resizePair(30, 30, -100), [5, 55]);
  assert.deepEqual(resizePair(5, 5, 3), [5, 5]);
  const [a, b] = resizePair(47, 33, 3.6);
  assert.equal(a + b, 80);
});

test('toPercent', () => {
  assert.equal(toPercent(250, 1000), 25);
  assert.equal(toPercent(1, 1000), 5);
  assert.equal(toPercent(999, 1000), 95);
  assert.equal(toPercent(10, 0), 5);
});
