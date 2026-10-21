// 0.26.0: where a flow rename is written (decision D4), the flow's title, and the Flows list filters (subsystem, component, changed, text, URL) with the
// Inventory subsystem select. Pure web modules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
// @ts-ignore plain JS modules shared with the browser
import { nameTarget, flowTitle } from '../web/js/views/flow-name.js';
// @ts-ignore
import { parseSel, encodeSel, subsystemRows, componentRows, summaryText, filterSummary, filterPoints, removedPoints } from '../web/js/views/flow-list-filter.js';
// @ts-ignore
import { subsystemOptions, inSubsystem, subsystemLabel } from '../web/js/views/inventory-subsystem.js';
// @ts-ignore
import { stripLabel } from '../web/js/collapse.js';
// @ts-ignore
import { createMarks } from '../web/js/design/marks-store.js';

test('D4: Edit with a draft writes a draft op; View, no draft or a sealed environment writes at once', () => {
  assert.equal(nameTarget({ mode: 'edit', draft: 'd' }, true), 'draft');
  assert.equal(nameTarget({ mode: 'edit', draft: null }, true), 'put');
  assert.equal(nameTarget({ mode: 'view', draft: 'd' }, true), 'put');
  assert.equal(nameTarget({ mode: 'edit', draft: 'd' }, false), 'put', 'sealed');
});

test('the title is the name, else the entry key', () => {
  assert.equal(flowTitle('  Agent connects ', 'pop-edge'), 'Agent connects');
  assert.equal(flowTitle('', 'pop-edge'), 'pop-edge');
  assert.equal(flowTitle(null, 'pop-edge'), 'pop-edge');
});

const P = (service: string, id: string, extra: any = {}) => ({ service, id, bindKey: `http:GET ${service}/${id}`, handler: `${id}.h`, entryPoint: true, ...extra });
const points = [P('a', 'x', { name: 'Sign in' }), P('a', 'y'), P('b', 'z', { summary: 'posture of a device' }), P('c', 'w'), P('d', 'v')];
const groupOf = new Map([['a', 'platform/identity'], ['b', 'platform'], ['c', 'network'], ['d', '']]);
const groups = [{ key: 'network', label: 'Network (POP)' }, { key: 'platform', label: 'Platform' }];

test('subsystem and component rows: top level, environment order, "(none)" last, counts of entry points', () => {
  const rows = subsystemRows(points, groupOf, groups);
  assert.deepEqual(rows.map((r: any) => [r.key, r.label, r.count]), [['network', 'Network (POP)', 1], ['platform', 'Platform', 3], ['', '(none)', 1]]);
  assert.deepEqual(componentRows(points, groupOf, new Set(['platform'])).map((r: any) => [r.name, r.count]), [['a', 2], ['b', 1]], 'components follow the subsystem choice');
  assert.equal(componentRows(points, groupOf, null).length, 4);
});

test('URL: a selection that is everything leaves the parameter out; none and "(none)" round-trip', () => {
  const all = ['network', 'platform', ''];
  assert.equal(encodeSel(null, all), null);
  assert.equal(encodeSel(new Set(all), all), null);
  assert.equal(encodeSel(new Set(['platform', '']), all), 'platform,-');
  assert.equal(encodeSel(new Set(), all), '-none-');
  assert.deepEqual([...parseSel('platform,-')], ['platform', '']);
  assert.equal(parseSel(null), null);
  assert.deepEqual([...parseSel('-none-')], []);
});

test('summary: All, up to two names, "3 of 5", None', () => {
  const rows = [{ key: 'a', label: 'A' }, { key: 'b', label: 'B' }, { key: 'c', label: 'C' }];
  assert.equal(summaryText(null, rows), 'All');
  assert.equal(summaryText(new Set(['a', 'b', 'c']), rows), 'All');
  assert.equal(summaryText(new Set(['a', 'c']), rows), 'A, C');
  assert.equal(summaryText(new Set(), rows), 'None');
  assert.equal(summaryText(new Set(['a', 'b']), [...rows, { key: 'd', label: 'D' }, { key: 'e', label: 'E' }]), 'A, B');
  assert.equal(summaryText(new Set(['a', 'b', 'c']), [...rows, { key: 'd', label: 'D' }, { key: 'e', label: 'E' }]), '3 of 5');
  assert.equal(filterSummary({ subs: null, comps: null, subRows: [], compRows: [], changed: null, q: '' }), '');
  assert.equal(stripLabel({ active: 'a/x', summary: 'subsystems Platform' }), 'a · subsystems Platform');
  assert.equal(stripLabel({ count: 3 }), 'Entry points (3)', 'no summary: as before');
});

test('filters combine: subsystem, component, text (name, summary, key) and Changed only', () => {
  const marks = createMarks({ against: 'baseline', source: 'prod', baselineAt: 'x', marks: { 'ing:a/y': { mark: 'new' }, 'ing:b/z': { mark: 'changed', what: '+1 call' }, 'ing:c/w': { mark: 'removed' } }, ghosts: { 'ing:c/gone': { label: 'GET /gone', service: 'c' } }, counts: {} });
  const ids = (o: any) => filterPoints(points, { groupOf, marks, ...o }).map((p: any) => `${p.service}/${p.id}`);
  assert.deepEqual(ids({}), ['a/x', 'a/y', 'b/z', 'c/w', 'd/v']);
  assert.deepEqual(ids({ subs: new Set(['platform']) }), ['a/x', 'a/y', 'b/z'], 'a nested path belongs to its top level');
  assert.deepEqual(ids({ subs: new Set(['platform']), comps: new Set(['b', 'c']) }), ['b/z'], 'components narrow the visible set');
  assert.deepEqual(ids({ subs: new Set(['']) }), ['d/v'], '"(none)"');
  assert.deepEqual(ids({ q: 'posture' }), ['b/z'], 'the text matches the summary');
  assert.deepEqual(ids({ q: 'sign in' }), ['a/x'], 'and the name');
  assert.deepEqual(ids({ changed: '1' }), ['a/y', 'b/z'], 'New and Changed; Removed is separate');
  assert.deepEqual(ids({ changed: '1', subs: new Set(['network']) }), []);
  assert.deepEqual(removedPoints(marks, { groupOf }).map((g: any) => g.label), ['GET /gone']);
  assert.deepEqual(removedPoints(marks, { groupOf, subs: new Set(['platform']) }), []);
});

test('inventory: the select shows when the environment has subsystems; a subsystem lists its services; nested paths belong to the top level', () => {
  const items = [{ type: 'service', groupPath: 'platform/identity' }, { type: 'service', groupPath: 'network' }, { type: 'service' }, { type: 'channel' }];
  assert.deepEqual(subsystemOptions(items, groups).map((o: any) => o[0]), ['', 'network', 'platform', '-']);
  assert.deepEqual(subsystemOptions(items, []).map((o: any) => o[0]), ['', 'network', 'platform/identity', '-'], 'a sealed environment uses the keys its services have');
  assert.deepEqual(subsystemOptions([{ type: 'service' }], []), [], 'no groupPath anywhere: no select');
  assert.equal(inSubsystem(items[0], 'platform'), true);
  assert.equal(inSubsystem(items[1], 'platform'), false);
  assert.equal(inSubsystem(items[2], '-'), true);
  assert.equal(inSubsystem(items[3], 'platform'), false, 'only services have a subsystem');
  assert.equal(inSubsystem(items[3], ''), true);
  assert.equal(subsystemLabel(items[2], groups), 'Not set');
  assert.equal(subsystemLabel({ type: 'service', groupPath: 'network' }, groups), 'Network (POP)');
});
