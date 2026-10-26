// #93: a flow that exists only in a draft shows the draft's own description as the human note; saving an edit of it
// (PUT ?draft=, MCP set_description draft) writes the description record in the draft's context instead of answering not-found.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startDesign } from './helpers.ts';

let app: Awaited<ReturnType<typeof startDesign>>;
const Q = 'service=pop&ingress=in.open';
before(async () => {
  app = await startDesign();
  await app.call('POST', '/api/envs/hld/drafts', { name: 'Save', slug: 'save' });
  const up = (anchor: string, data: unknown) => ({ op: 'upsert', anchor, data });
  const r = await app.call('POST', '/api/envs/hld/drafts/save/ops', { ops: [
    up('svc:pop', { kind: 'service', groupPath: 'agent', team: 'net' }),
    up('fn:pop/H', { id: 'H', name: 'H', steps: [{ seq: 1, type: 'egress', target: 'out.v' }] }),
    up('ing:pop/in.open', { id: 'in.open', transport: 'socket', bindKey: 'socket:tls/pop/open', handler: 'H', entryPoint: true }),
    up('egr:pop/out.v', { id: 'out.v', transport: 'http', mode: 'sync', bindKey: 'http:POST auth-svc/verify' }),
    up('flow:pop/in.open', { name: 'Agent connects', description: 'Agent opens a tunnel.' }),
  ] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});
after(() => app.close());

test('PUT descriptions?draft= upserts the human description of a draft-sourced flow', async () => {
  const g = (await app.call('GET', `/api/envs/hld/descriptions?${Q}&draft=save`)).body;
  assert.equal(g.flow.human.editedBy, 'draft');
  const p = await app.call('PUT', '/api/envs/hld/descriptions?draft=save', { service: 'pop', ingress: 'in.open', text: 'Edited tunnel text.', editedBy: 'web' });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  const n = (await app.call('GET', `/api/envs/hld/descriptions?${Q}&draft=save`)).body;
  assert.equal(n.flow.human.text, 'Edited tunnel text.');
  assert.equal(n.flow.human.editedBy, 'web');
});

test('PUT without ?draft= still refuses a flow the environment does not have', async () => {
  const p = await app.call('PUT', '/api/envs/hld/descriptions', { service: 'pop', ingress: 'in.open', text: 'x' });
  assert.equal(p.status, 404);
});

test('MCP set_description takes draft and saves the AI record for a draft-only flow', async () => {
  const r = await app.mcp('set_description', { env: 'hld', draft: 'save', service: 'pop', ingress: 'in.open', text: 'AI summary.', model: 'test-model' });
  assert.equal(r.isError, false, r.text.slice(0, 200));
  const n = (await app.call('GET', `/api/envs/hld/descriptions?${Q}&draft=save`)).body;
  assert.equal(n.flow.ai.text, 'AI summary.');
  assert.equal((await app.mcp('set_description', { env: 'hld', draft: 'nope', service: 'pop', ingress: 'in.open', text: 'x', model: 'm' })).isError, true);
});
