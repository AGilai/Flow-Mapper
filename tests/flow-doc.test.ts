// Unreleased (frame 28a/f): the flow doc's two switches (enabled in View > Descriptions, shown by the pane's X and the tab's note icon), remembered per viewer;
// the design doc's docked state per environment; and the badges the diagram draws from a flow's Notes body, end to end through the pure readers.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map<string, string>();
(globalThis as any).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, String(v)); }, removeItem: (k: string) => { store.delete(k); } };
beforeEach(() => store.clear());

const fresh = async () => import(`../web/js/notes/flow-doc-state.js?${Math.random()}`);
const dock = async () => import('../web/js/notes/dock-state.js');
import { sanitize } from '../core/rich-text.ts';
import { callouts, badges } from '../core/callouts.ts';

test('flow doc: on by default; hidden and off are remembered separately; visible only when enabled and shown', async () => {
  let m = await fresh();
  assert.deepEqual({ ...m.flowDoc() }, { enabled: true, shown: true }); assert.equal(m.docVisible(), true);
  const seen: boolean[] = []; const off = m.onFlowDoc((s: any) => seen.push(m.docVisible()));
  m.setFlowDoc('shown', false); assert.equal(m.docVisible(), false); assert.equal(m.flowDoc().enabled, true, 'hidden keeps the tab icon (a1/a2)');
  m.setFlowDoc('enabled', false); assert.equal(m.flowDoc().shown, false);
  m.setFlowDoc('enabled', false); // no change: no notice
  assert.deepEqual(seen, [false, false]); off();
  m = await fresh(); // a reload reads what was kept
  assert.deepEqual({ ...m.flowDoc() }, { enabled: false, shown: false });
  m.revealFlowDoc(); assert.equal(m.docVisible(), true, 'a link to a comment brings the pane back whatever hid it');
  m = await fresh(); assert.equal(m.docVisible(), true);
});

test('flow doc: storage that throws means shown', async () => {
  const keep = (globalThis as any).localStorage;
  (globalThis as any).localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  try { const m = await fresh(); assert.equal(m.docVisible(), true); m.setFlowDoc('shown', false); assert.equal(m.docVisible(), false); } finally { (globalThis as any).localStorage = keep; }
});

test('design doc dock: per environment, off by default, tells subscribers', async () => {
  const d = await dock(), seen: string[] = [], off = d.onDocked((env: string, on: boolean) => seen.push(`${env}:${on}`));
  assert.equal(d.isDocked('sub-bands'), false);
  d.setDocked('sub-bands', true); assert.equal(d.isDocked('sub-bands'), true); assert.equal(d.isDocked('prod'), false, 'another environment is not affected');
  d.setDocked('sub-bands', false); assert.equal(d.isDocked('sub-bands'), false); assert.equal(store.has('flow-mapper.design-dock:sub-bands'), false, 'hidden leaves nothing behind');
  assert.deepEqual(seen, ['sub-bands:true', 'sub-bands:false']); off();
});

test('old plain notes still read as the body; a flow doc turns its callouts into the diagram badges', () => {
  const old = '<h2>Purpose</h2><p>Plain note from 0.34.0 with <span data-step="2">step 2</span>.</p>';
  assert.equal(sanitize(old, { notes: true }), old); assert.deepEqual(callouts(old), []); assert.deepEqual(badges(callouts(old), 3), []);
  const body = sanitize(`${old}<div data-callout="watch" data-step="1"><p>w</p></div><div data-callout="key" data-step="2"><p>k</p></div><div data-callout="risk" data-step="7"><p>gone</p></div>`, { notes: true });
  assert.deepEqual(badges(callouts(body), 3).map((b) => [b.step, b.badge]), [[1, 'bang'], [2, 'star']], 'step 7 is not in a flow of 3 steps');
});
