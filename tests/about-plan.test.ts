// `about` in an import plan (0.30.2, #68): environment.groups[].about and extensions[].about. Pure.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PlanError, planToOps } from '../core/import-plan.ts';
import { rows } from './subsystem-fixture.ts';

const cx = { env: 't', groups: [], validateManifest: () => [], baselineVersion: () => undefined };
const run = (extra: any) => planToOps({ planVersion: 1, ...extra }, rows(), cx);

test('about: a new group takes it; a known group is updated; a too long one is a warning; an extension sets it on the header', () => {
  const r = run({ environment: { groups: [{ key: 'edge', label: 'Edge', about: '## Owners\n- me' }, { key: 'misc', label: 'Misc', about: 'x'.repeat(20001) }, { key: 'agent', label: 'Agent', about: 'Agent text' }] }, links: [] });
  assert.deepEqual(r.ops.map((o) => [o.anchor, (o.data as any).about?.slice(0, 14)]), [['grp:edge', '## Owners\n- me'], ['grp:misc', undefined], ['grp:agent', 'Agent text']]);
  assert.ok(r.warnings.some((w) => /subsystem 'misc'.*longer than/.test(w)));
  const x = run({ extensions: [{ service: 'auth-svc', about: '## Owners\n- core' }] });
  assert.equal((x.ops.find((o) => o.anchor === 'svc:auth-svc')!.data as any).about, '## Owners\n- core');
  assert.throws(() => run({ extensions: [{ service: 'auth-svc', about: 5 }] }), PlanError);
});
