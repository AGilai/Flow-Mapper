// #55: `entryPoint` on an ingress: true always, false never (a hop keeps its real transport), absent the default rule
// (a socket ingress is one). Through manifests, draft ops, the endpoint form and the flow form.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
before(async () => { app = await startDesign(); });
after(() => app.close());

const D = '/api/envs/hld/drafts';
const sock = (id: string, extra: object = {}) => ({ id, transport: 'socket', bindKey: `socket:tls/hop/${id}`, handler: 'H', ...extra });
const ids = async (q = '') => ((await app.call('GET', `/api/envs/hld/entry-points${q}`)).body as any[]).map((e) => e.id);
const edit = (slug: string, e: object) => app.call('POST', `${D}/${slug}/edits`, { edit: e, author: 'ana' });

test('socket ingress: absent is an entry point, true too, false is not; through draft ops', async () => {
  assert.equal((await app.call('POST', D, { name: 'Hops', slug: 'hops' })).status, 201);
  const r = await app.call('POST', `${D}/hops/ops`, { ops: [
    { op: 'upsert', anchor: 'fn:auth-svc/H', data: { id: 'H', name: 'H', steps: [] } },
    { op: 'upsert', anchor: 'ing:auth-svc/in.s-absent', data: sock('in.s-absent') },
    { op: 'upsert', anchor: 'ing:auth-svc/in.s-true', data: sock('in.s-true', { entryPoint: true }) },
    { op: 'upsert', anchor: 'ing:auth-svc/in.s-false', data: sock('in.s-false', { entryPoint: false }) },
    { op: 'upsert', anchor: 'ing:auth-svc/in.h-false', data: { id: 'in.h-false', transport: 'http', bindKey: 'http:GET auth-svc/hf', handler: 'H', entryPoint: false } },
  ] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const got = await ids('?draft=hops');
  assert.deepEqual(['in.s-absent', 'in.s-true'].filter((i) => !got.includes(i)), []);
  assert.deepEqual(['in.s-false', 'in.h-false'].filter((i) => got.includes(i)), [], 'false is never an entry point');
});

test('the endpoint and flow forms keep an explicit false; null clears to the default rule', async () => {
  assert.equal((await app.call('POST', D, { name: 'Forms', slug: 'forms' })).status, 201);
  const e = await edit('forms', { kind: 'endpoint', service: 'auth-svc', id: 'in.hop', transport: 'socket', bindKey: 'socket:tls/hop/forms', entryPoint: false });
  assert.equal(e.status, 201, JSON.stringify(e.body));
  assert.equal((await ids('?draft=forms')).includes('in.hop'), false);
  assert.equal((await edit('forms', { kind: 'flow', service: 'auth-svc', ingress: 'in.hop', entryPoint: true })).status, 201);
  assert.equal((await ids('?draft=forms')).includes('in.hop'), true);
  assert.equal((await edit('forms', { kind: 'flow', service: 'auth-svc', ingress: 'in.hop', entryPoint: false })).status, 201);
  assert.equal((await ids('?draft=forms')).includes('in.hop'), false);
  assert.equal((await edit('forms', { kind: 'flow', service: 'auth-svc', ingress: 'in.hop', entryPoint: null })).status, 201);
  assert.equal((await ids('?draft=forms')).includes('in.hop'), true, 'absent: a socket ingress is an entry point again');
});
