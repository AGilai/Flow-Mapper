// 0.24.0: marks on flows (the arrow -> anchor rule), the inventory status filter, field rows and the removed list. Pure web modules, plus the real
// marks and trace of the demo draft (sase-hld, hld-import) to show the rule on the data it is for.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { SAMPLES, startApp } from './helpers.ts';
import { seedEnvRecipes } from '../scripts/seed-envs.ts';
// @ts-ignore plain JS modules shared with the browser
import { arrowMark, headAnchor, laneMarks, servicesOf } from '../web/js/views/flow-marks.js';
// @ts-ignore
import { createMarks } from '../web/js/design/marks-store.js';
// @ts-ignore
import { anchorOfItem, statusCounts, filterByStatus, statusOf } from '../web/js/views/inventory-status.js';
// @ts-ignore
import { mergeRows, rowsOfFields, fieldSentence } from '../web/js/components/field-merge.js';
// @ts-ignore
import { removedTitle, removedCalls } from '../web/js/views/flow-removed.js';
// @ts-ignore
import { groupChanges, serviceOfAnchor } from '../web/js/design/changes-group.js';

const store = (marks: any, ghosts: any = {}, extra: any = {}) => createMarks({ against: 'baseline', source: 'prod', baselineAt: 'x', marks, ghosts, counts: {}, ...extra });

test('arrow rule: the call own mark wins, else a new endpoint it reaches; a head is its service; nothing else carries a mark', () => {
  const s = store({ 'egr:a/out.x': { mark: 'new' }, 'ing:b/in.y': { mark: 'new' }, 'ing:c/in.z': { mark: 'changed' }, 'svc:a': { mark: 'changed' }, 'egr:a/out.q': { mark: 'removed' } });
  const call = (service: string, egress: string | undefined, target?: [string, string]) => ({ service, egress, ...(target ? { target: { service: target[0], ingress: target[1] } } : {}) });
  assert.equal(arrowMark(s, call('a', 'out.x', ['b', 'in.y'])).anchor, 'egr:a/out.x', 'the egress mark wins over the target');
  assert.equal(arrowMark(s, call('a', 'out.other', ['b', 'in.y'])).anchor, 'ing:b/in.y', 'else a new endpoint it reaches');
  assert.equal(arrowMark(s, call('a', 'out.other', ['c', 'in.z'])), null, 'a changed endpoint does not mark the arrow');
  assert.equal(arrowMark(s, call('a', undefined, ['b', 'in.y'])).anchor, 'ing:b/in.y', 'an entry message has no egress');
  assert.equal(arrowMark(s, call('zzz', 'out.none')), null);
  assert.equal(arrowMark(null, call('a', 'out.x')), null);
  assert.equal(headAnchor({ kind: 'service', service: 'a' }), 'svc:a');
  assert.equal(headAnchor({ kind: 'channel', service: 'a' }), null);
  assert.equal(headAnchor({ kind: 'client' }), null);
  const lm = laneMarks(s);
  assert.equal(lm.head({ kind: 'service', service: 'a' }).info.mark, 'changed');
  assert.equal(lm.arrow(call('a', 'out.q')), null, 'a removed call is not an arrow of the diagram: the list under it names it');
  assert.equal(laneMarks(store({})), null, 'no marks: nothing to draw');
  assert.deepEqual(servicesOf({ participants: [{ kind: 'service', service: 'a' }, { kind: 'client' }, { kind: 'service', service: 'a' }, { kind: 'service', service: 'b' }] }), ['a', 'b']);
});

test('on the demo draft: the new component head carries the spark, its own calls none; a call into a new endpoint of an existing component is marked', async () => {
  const app = await startApp();
  try {
    const all = (d: string) => readdirSync(d).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(readFileSync(join(d, f), 'utf8')));
    await app.call('POST', '/api/ingest', { manifests: all(SAMPLES) });
    seedEnvRecipes(app.ctx, join(SAMPLES, 'envs'));
    const m = store(...((b: any) => [b.marks, b.ghosts, { counts: b.counts }])((await app.call('GET', '/api/envs/sase-hld/marks?draft=hld-import')).body));
    const t = (await app.call('GET', '/api/envs/sase-hld/trace?service=sase-agent&ingress=in.tunnel.open&draft=hld-import')).body;
    assert.equal(m.markOf('svc:sase-agent').mark, 'new');
    const marked = t.messages.map((x: any) => arrowMark(m, x)).filter(Boolean).map((r: any) => r.anchor);
    assert.deepEqual(marked, ['ing:auth-svc/in.token.device'], 'only the call into the new endpoint of auth-svc; the calls of the new components carry none (their heads do)');
    const lm = laneMarks(m);
    assert.deepEqual(servicesOf(t).filter((s: string) => lm.head({ kind: 'service', service: s })?.info.mark === 'new'), ['sase-agent', 'pop-edge']);
    assert.equal(lm.head({ kind: 'service', service: 'auth-svc' }).info.mark, 'changed');
  } finally { await app.close(); }
});

const items = [
  { type: 'service', id: 'a' }, { type: 'service', id: 'b' }, { type: 'service', id: 'c' }, { type: 'channel', id: 'sqs:q' }, { type: 'event', id: 'Ev' }, { type: 'store', id: 'redis:x' },
];

test('inventory filter: counts are the rows, the filter keeps what it counts, only services / channels / events carry marks', () => {
  const m = store({ 'svc:a': { mark: 'new' }, 'svc:b': { mark: 'changed' }, 'evt:Ev': { mark: 'changed', what: '1 new field' } });
  assert.deepEqual(items.map(anchorOfItem), ['svc:a', 'svc:b', 'svc:c', 'ch:sqs:q', 'evt:Ev', null]);
  const c = statusCounts(items, m);
  assert.deepEqual(c, { '': 6, new: 1, changed: 2, unchanged: 3 });
  for (const k of ['new', 'changed', 'unchanged']) assert.equal(filterByStatus(items, k, m).length, c[k], k);
  assert.equal(filterByStatus(items, '', m).length, 6);
  assert.equal(c.new + c.changed + c.unchanged, c[''], 'the three add up to All');
  assert.equal(statusOf(items[5], m), 'unchanged');
});

test('field rows: removed fields come back as rows under their parent, in order; example JSON gets rows too; the sentence counts', () => {
  const rows = [{ path: 'id', name: 'id', depth: 0, type: 'string', required: true }, { path: 'dev', name: 'dev', depth: 0, type: 'object', required: false }, { path: 'dev.os', name: 'os', depth: 1, type: 'string', required: false }, { path: 'zz', name: 'zz', depth: 0, type: 'string', required: false }];
  const fm = new Map<string, any>([['id', { mark: 'changed', was: 'was number' }], ['dev.fp', { mark: 'removed' }], ['top', { mark: 'removed' }], ['zz', { mark: 'new' }]]);
  const out = mergeRows(rows, fm);
  assert.deepEqual(out.map((r: any) => r.path), ['id', 'dev', 'dev.os', 'dev.fp', 'zz', 'top']);
  assert.equal(out[0].mark.mark, 'changed'); assert.equal(out[1].mark, null);
  assert.deepEqual([out[3].removed, out[3].depth, out[3].name, out[5].depth], [true, 1, 'fp', 0]);
  assert.equal(fieldSentence(fm), '1 new, 1 changed, 2 removed');
  assert.equal(fieldSentence(new Map()), '');
  const ex = rowsOfFields(new Map([['b', { type: 'string', required: false }], ['a.x', { type: 'number', required: false }], ['a', { type: 'object', required: false }]]));
  assert.deepEqual(ex.map((r: any) => [r.path, r.depth, r.name]), [['a', 0, 'a'], ['a.x', 1, 'x'], ['b', 0, 'b']]);
  assert.deepEqual(mergeRows([{ path: 'l[]', name: 'l', depth: 0, type: 'array' }, { path: 'l[].a', name: 'a', depth: 1, type: 'string' }], new Map([['l[].b', { mark: 'removed' }]])).map((r: any) => r.path), ['l[]', 'l[].a', 'l[].b']);
});

test('removed list: calls of the services in view; the wording follows what the marks compare with', () => {
  const m = store({}, { 'egr:a/out.1': { label: 'out.1', service: 'a' }, 'egr:b/out.2': { label: 'out.2', service: 'b' }, 'egr:c/out.3': { label: 'out.3', service: 'c' }, 'svc:d': { label: 'd' } });
  assert.deepEqual(removedCalls(m, ['a', 'b']).map((g: any) => g.label), ['out.1', 'out.2']);
  assert.deepEqual(removedCalls(m, ['x']), []);
  assert.equal(removedTitle(m, 2, 'hld-import'), '2 calls removed in this draft');
  assert.equal(removedTitle(m, 1, null), '1 call removed since the baseline');
  assert.equal(removedTitle(store({}, {}, { against: 'source' }), 3, null), '3 calls only in prod', 'against the source it is not "removed"');
});

test('review list: grouped by component, children of an added component under it, shared items last', () => {
  const g = groupChanges([
    { anchor: 'ing:b/in.x', change: 'added', label: 'in.x', under: 'svc:b', authors: [] }, { anchor: 'svc:b', change: 'added', label: 'b', authors: [] },
    { anchor: 'egr:a/out.y', change: 'removed', label: 'out.y', authors: [] }, { anchor: 'ch:sqs:q', change: 'added', label: 'sqs:q', authors: [] }, { anchor: 'evt:Ev', change: 'changed', label: 'Ev', authors: [] },
  ]);
  assert.deepEqual(g.map((x: any) => x.service), ['a', 'b', '']);
  assert.deepEqual(g[1].items.map((i: any) => i.anchor), ['svc:b', 'ing:b/in.x'], 'the component first');
  assert.equal(g[2].items.length, 2);
  assert.deepEqual(['dto:a/response/-/in.x#f', 'ing:a/in.x', 'flow:a/in.x', 'ch:amqp:q', 'schema:code/mongodb:db/c'].map(serviceOfAnchor), ['a', 'a', 'a', '', '']);
});
