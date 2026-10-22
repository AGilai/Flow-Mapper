// 0.32.5 (#79): the Flows list "Group by": natural order of the flat list, defaults per environment kind, the URL form and the remembered choice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { naturalCompare, flatOrder, groupDefault, decodeGroup, encodeGroup, startGroup, storedGroup, saveGroup } from '../web/js/views/flow-list-groupby.js';

const names = (ps: any[]) => ps.map((p) => p.name || p.bindKey);

test('natural order: ARL_2 before ARL_10, case ignored', () => {
  assert.ok(naturalCompare('ARL_2', 'ARL_10') < 0);
  assert.ok(naturalCompare('arl_9 login', 'ARL_10 login') < 0);
  assert.equal(naturalCompare('Abc', 'abc'), 0);
});

test('flat order: named by name, then unnamed by their label; ties by component', () => {
  const ps = [
    { service: 'b', name: 'ARL_10', bindKey: 'http:GET /z' }, { service: 'a', name: '', bindKey: 'http:GET /m' }, { service: 'a', name: 'ARL_2', bindKey: 'http:GET /y' },
    { service: 'c', name: '', bindKey: 'http:GET /a' }, { service: 'a', name: 'ARL_1', bindKey: 'http:GET /x' }, { service: 'a', name: 'ARL_1', bindKey: 'http:GET /x2' },
  ];
  const out = flatOrder(ps);
  assert.deepEqual(names(out), ['ARL_1', 'ARL_1', 'ARL_2', 'ARL_10', 'http:GET /a', 'http:GET /m']);
  assert.equal(ps[0].name, 'ARL_10', 'the input is not reordered');
});

test('defaults: None in a design, Component in a harvested environment', () => {
  assert.equal(groupDefault(true), 'none');
  assert.equal(groupDefault(false), 'component');
});

test('group= is omitted at the kind default and read back; an unknown value is ignored', () => {
  assert.equal(encodeGroup('none', true), null);
  assert.equal(encodeGroup('component', true), 'component');
  assert.equal(encodeGroup('component', false), null);
  assert.equal(encodeGroup('none', false), 'none');
  assert.equal(decodeGroup(new URLSearchParams('group=none')), 'none');
  assert.equal(decodeGroup(new URLSearchParams('group=nope')), null);
  assert.equal(decodeGroup(new URLSearchParams('')), null);
});

test('the start mode: URL, else remembered per environment, else the default; storage failing is fine', () => {
  const mem = new Map<string, string>();
  (globalThis as any).localStorage = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => { mem.set(k, v); } };
  try {
    assert.equal(startGroup(new URLSearchParams(''), 'd1', true), 'none');
    saveGroup('d1', 'component');
    assert.equal(storedGroup('d1', true), 'component');
    assert.equal(startGroup(new URLSearchParams(''), 'd1', true), 'component');
    assert.equal(startGroup(new URLSearchParams(''), 'd2', true), 'none', 'per environment');
    assert.equal(startGroup(new URLSearchParams('group=none'), 'd1', true), 'none', 'the URL wins');
    (globalThis as any).localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
    saveGroup('d1', 'none');
    assert.equal(startGroup(new URLSearchParams(''), 'd1', false), 'component');
  } finally { delete (globalThis as any).localStorage; }
});
