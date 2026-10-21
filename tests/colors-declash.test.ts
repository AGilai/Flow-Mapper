// 0.28.1: the per-flow colour de-clash (core/colors.ts declash): two components of one flow on one slot are told apart, the stored slots stay.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assignColors, declash } from '../core/colors.ts';

const flow = (slots: (number | null)[]) => slots.map((slot, i) => ({ name: `c${i}`, slot }));
const out = (m: Map<string, number>) => [...m.values()];

test('declash: distinct slots stay as they are', () => {
  assert.deepEqual(out(declash(flow([1, 2, 3]))), [1, 2, 3]);
});

test('declash: a slot used earlier in the flow moves to the next free one, cyclic from slot + 1', () => {
  assert.deepEqual(out(declash(flow([2, 2]))), [2, 3]);
  assert.deepEqual(out(declash(flow([8, 8]))), [8, 1], 'cyclic: after 8 comes 1');
  assert.deepEqual(out(declash(flow([2, 3, 2]))), [2, 3, 4], 'the next free slot skips the ones this flow uses');
});

test('declash: neutral components (no slot) are left out; past 8 distinct the palette repeats', () => {
  assert.deepEqual([...declash(flow([null, 1, null, 1])).keys()], ['c1', 'c3']);
  const nine = declash(flow([1, 1, 1, 1, 1, 1, 1, 1, 1]));
  assert.deepEqual(out(nine).slice(0, 8), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.equal(nine.get('c8'), 1, 'the 9th repeats the first slot');
});

test('declash: the stored assignment is never touched (it is a read of the input)', () => {
  const stored = { a: 3, b: 3 }, before = { ...stored };
  declash(Object.entries(stored).map(([name, slot]) => ({ name, slot })));
  assert.deepEqual(stored, before);
});

test('the prod sample has far more components than slots; two on one slot in a flow are separated', async () => {
  {
    const { readdirSync, readFileSync } = await import('node:fs');
    const dir = new URL('../samples/', import.meta.url);
    const names: string[] = [];
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
      const m = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
      if (m.env === 'prod' && m.service?.name) names.push(m.service.name);
    }
    const colors = assignColors({}, names.map((name) => ({ name })));
    assert.equal(Object.keys(colors).length, new Set(names).size);
    assert.ok(Object.keys(colors).length >= 40, 'many more components than the 8 slots');
    const clash = Object.entries(colors).filter(([, s]) => s === 1).slice(0, 2).map(([name]) => ({ name, slot: 1 }));
    assert.equal(clash.length, 2);
    const fixed = declash(clash);
    assert.notEqual(fixed.get(clash[0].name), fixed.get(clash[1].name));
  }
});
