// #149: harvested path parameter names are drawn on the arrows that reach a route. Demo: samples/group-paths.json `in.unregisterDevice`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { namedPath } from '../core/path-params.ts';
import { namedPath as webNamedPath } from '../web/js/views/flow-param-title.js';
import { callLabel } from '../web/js/views/flow-call-label.js';
import { entryParamsFor, paramTitle } from '../web/js/views/flow-param-title.js';
import { buildIndex } from '../core/graph-index.ts';
import { trace } from '../core/trace.ts';
import { sampleModel } from './helpers.ts';

const P = (...n: string[]) => n.map((name) => ({ name }));

test('namedPath: positional replacement of {p1}, {} and :id; unchanged on no names or a count mismatch', () => {
  assert.equal(namedPath('/api/v1/devices/client/{p1}', P('deviceIdentifier')), '/api/v1/devices/client/{deviceIdentifier}');
  assert.equal(namedPath('/a/{p1}/b/{p2}', P('x', 'y')), '/a/{x}/b/{y}');
  assert.equal(namedPath('/a/{}/{}', P('g', 'm')), '/a/{g}/{m}');
  assert.equal(namedPath('/a/:id/b', P('groupId')), '/a/{groupId}/b');
  assert.equal(namedPath('/a/{p1}/{p2}', P('x')), '/a/{p1}/{p2}', 'count differs');
  assert.equal(namedPath('/a/{p1}', undefined), '/a/{p1}');
  assert.equal(namedPath('/a/{p1}', []), '/a/{p1}');
  assert.equal(namedPath('/a/b', P('x')), '/a/b');
  for (const [p, n] of [['/a/{p1}/{p2}', P('x', 'y')], ['/a/{}', P('q')], ['/a/:id/b/{z}', P('k', 'l')], ['/a/{p1}', P('x', 'y')], ['/a', []]] as const) assert.equal(webNamedPath(p, n as any), namedPath(p, n as any), 'web mirror: ' + p);
});

test('callLabel draws the named path', () => {
  const m: any = { transport: 'http', label: 'http:DELETE h/api/x/{p1}', kind: 'entry', pathParams: P('deviceIdentifier') };
  assert.equal(callLabel(m), 'DELETE /api/x/{deviceIdentifier}');
  assert.equal(callLabel({ ...m, pathParams: undefined }), 'DELETE /api/x/{p1}');
});

test('the trace carries pathParams on the entry; the steps of the entry request read them, steps after a call out do not', () => {
  const g = buildIndex(sampleModel());
  const t = trace(g, { service: 'group-paths', ingress: 'in.unregisterDevice' }, { scope: 'full' })!;
  const entry = t.messages[0];
  assert.deepEqual(entry.pathParams?.map((p) => p.name), ['deviceIdentifier']);
  assert.equal(callLabel(entry), 'DELETE /api/v1/devices/client/{deviceIdentifier}');
  assert.match(paramTitle(entry), /deviceIdentifier \(string\)/);
  const step1 = t.messages[1];
  assert.equal(entryParamsFor(step1, t)?.[0].name, 'deviceIdentifier');
  const other = trace(g, { service: 'group-paths', ingress: 'in.removeGroup' }, { scope: 'full' })!;
  assert.equal(other.messages[0].pathParams, undefined, 'no harvested names: nothing carried');
});
