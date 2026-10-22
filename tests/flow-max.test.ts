// 0.29.1: maximize a flow, the pure part: which keys toggle or exit, and the URL state.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { maxKeyAction, maxFromQuery, maxPatch } from '../web/js/views/flow-max-pure.js';

const key = (k: string, extra: any = {}) => ({ key: k, target: { tagName: 'DIV' }, ...extra });

test('F toggles, unless the caret is in a field, an editor or a dialog, or a modifier is held', () => {
  assert.equal(maxKeyAction(key('f')), 'toggle');
  assert.equal(maxKeyAction(key('F')), 'toggle');
  for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT']) assert.equal(maxKeyAction(key('f', { target: { tagName } })), null);
  assert.equal(maxKeyAction(key('f', { target: { tagName: 'DIV', isContentEditable: true } })), null);
  assert.equal(maxKeyAction(key('f'), { dialogOpen: true }), null);
  assert.equal(maxKeyAction(key('f', { ctrlKey: true })), null);
  assert.equal(maxKeyAction(key('f', { metaKey: true })), null);
  assert.equal(maxKeyAction(key('f', { altKey: true })), null);
  assert.equal(maxKeyAction(key('f', { defaultPrevented: true })), null);
});

test('Esc exits only while maximized, and never from an editor, a dialog or a handled key', () => {
  assert.equal(maxKeyAction(key('Escape')), null);
  assert.equal(maxKeyAction(key('Escape'), { maximized: true }), 'exit');
  assert.equal(maxKeyAction(key('Escape', { target: { tagName: 'DIV', isContentEditable: true } }), { maximized: true }), null);
  assert.equal(maxKeyAction(key('Escape', { target: { tagName: 'INPUT' } }), { maximized: true }), null);
  assert.equal(maxKeyAction(key('Escape'), { maximized: true, dialogOpen: true }), null);
  assert.equal(maxKeyAction(key('Escape', { defaultPrevented: true }), { maximized: true }), null);
});

test('max=1 in the URL is the state', () => {
  assert.equal(maxFromQuery(new URLSearchParams('tabs=a/b&max=1')), true);
  assert.equal(maxFromQuery(new URLSearchParams('max=0')), false);
  assert.equal(maxFromQuery(new URLSearchParams('')), false);
  assert.deepEqual(maxPatch(true), { max: '1' });
  assert.deepEqual(maxPatch(false), { max: null });
});
