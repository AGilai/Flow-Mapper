// Collapsible panels: state kept per browser, tolerant of broken storage (web/js/collapse.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS module shared with the browser
import { KEYS, readCollapsed, writeCollapsed, toggleLabel, stripLabel, envShort } from '../web/js/collapse.js';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };

test('each panel keeps its own state; the default is expanded', () => {
  const s = mem();
  assert.equal(readCollapsed(KEYS.rail, s), false);
  writeCollapsed(KEYS.rail, true, s);
  assert.equal(readCollapsed(KEYS.rail, s), true);
  assert.equal(readCollapsed(KEYS.list, s), false, 'the other panel is untouched');
  writeCollapsed(KEYS.rail, false, s);
  assert.equal(readCollapsed(KEYS.rail, s), false);
  assert.notEqual(KEYS.rail, KEYS.list);
});

test('storage that throws or is missing never breaks the panel', () => {
  const bad = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
  assert.equal(readCollapsed(KEYS.list, bad), false);
  assert.equal(writeCollapsed(KEYS.list, true, bad), true);
  assert.equal(readCollapsed(KEYS.list, null), false);
});

test('labels: the control says what a click does; the strip names the service; the env chip is short', () => {
  assert.equal(toggleLabel('the sidebar', false), 'Collapse the sidebar');
  assert.equal(toggleLabel('the sidebar', true), 'Expand the sidebar');
  assert.equal(stripLabel({ service: 'orders-svc', count: 4 }), 'orders-svc');
  assert.equal(stripLabel({ active: 'api-gateway/in.createOrder~Ev!intra' }), 'api-gateway');
  assert.equal(stripLabel({ active: 'full:saga-controller/in.start@x' }), 'saga-controller');
  assert.equal(stripLabel({ count: 12 }), 'Entry points (12)');
  assert.equal(envShort('prod'), 'prod');
  assert.equal(envShort('scale-test'), 'scale');
  assert.equal(envShort(''), '·');
});
