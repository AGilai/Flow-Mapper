// Step code location and ingress via (#30): step.source {file, line, col} and ingress.via (registration / bind hops).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.ts';
import { viaLabel } from '../core/via.ts';

let app: Awaited<ReturnType<typeof startApp>>;
const base = (name: string) => ({ schemaVersion: '1.0', kind: 'full', env: 'e', service: { name, kind: 'service', repo: 'github.com/acme/' + name }, version: 1, harvestedAt: '2026-10-20T08:00:00Z', commit: 'b6c8c6b' });
const hops = [{ function: 'registerHandlers', file: 'src/index.ts', line: 12, kind: 'registration' }, { function: 'Handler.process', file: 'src/h.ts', line: 30, kind: 'bind' }];
const mcp = async (name: string, args: object) => JSON.parse((await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: { env: 'e', ...args } } })).body.result.content[0].text);

before(async () => {
  app = await startApp();
  const r = await app.call('POST', '/api/ingest', { manifests: [
    { ...base('api'), functions: [
      { id: 'run', name: 'run', steps: [{ seq: 1, type: 'call', target: 'inner', source: { file: 'src/run.ts', line: 7, col: 5 } }, { seq: 2, type: 'egress', target: 'q' }] },
      { id: 'inner', name: 'inner', steps: [] }],
      egress: [{ id: 'q', bindKey: 'sqs:jobs', transport: 'sqs' }], ingress: [{ id: 'in', bindKey: 'http:GET api/x', transport: 'http', handler: 'run', entryPoint: true }] },
    { ...base('worker'), functions: [{ id: 'proc', name: 'proc', steps: [] }, { id: 'old', name: 'old', steps: [] }],
      ingress: [{ id: 'c', bindKey: 'sqs:jobs', transport: 'sqs', handler: 'proc', via: hops },
        { id: 'legacy', bindKey: 'sqs:other', transport: 'sqs', handler: 'old', details: { handlerVia: hops.slice(1) } }] },
  ] });
  assert.equal(r.status, 201, JSON.stringify(r.body));
});
after(() => app.close());

test('the schema rejects a step source with a bad line and an ingress via with no function', async () => {
  const bad = (x: object) => app.call('POST', '/api/ingest', { manifests: [{ ...base('bad'), ...x }] });
  assert.ok((await bad({ functions: [{ id: 'f', name: 'f', steps: [{ seq: 1, type: 'call', target: 'f', source: { line: 0 } }] }] })).status >= 400);
  assert.ok((await bad({ functions: [{ id: 'f', name: 'f' }], ingress: [{ id: 'i', bindKey: 'sqs:z', transport: 'sqs', handler: 'f', via: [{ file: 'a.ts' }] }] })).status >= 400);
});

test('trace links the step source and carries handlerVia on the delivery, in the API and in MCP', async () => {
  for (const t of [(await app.call('GET', '/api/envs/e/trace?service=api&ingress=in&scope=full')).body, await mcp('trace_flow', { service: 'api', ingress: 'in' })]) {
    assert.equal(t.code['step:api:run#1'].url, 'https://github.com/acme/api/blob/b6c8c6b/src/run.ts#L7');
    assert.ok(!('step:api:run#2' in t.code), 'a step without a source has no link');
    const hop = t.messages.find((m: any) => m.target?.service === 'worker');
    assert.equal(viaLabel(hop.handlerVia), 'Handler.process');
    assert.equal(hop.handlerVia[0].link.url, 'https://github.com/acme/worker/blob/b6c8c6b/src/index.ts#L12');
    assert.equal(t.messages.filter((m: any) => m.via).length, 0, 'handler hops are not egress via');
  }
});

test('service view, endpoint info and an entry trace show ingress via, also from details.handlerVia', async () => {
  const v = (await app.call('GET', '/api/envs/e/views/service/worker')).body.ingress;
  assert.deepEqual(v.find((i: any) => i.id === 'c').via.map((h: any) => h.kind), ['registration', 'bind']);
  assert.deepEqual(v.find((i: any) => i.id === 'legacy').via.map((h: any) => h.function), ['Handler.process']);
  assert.equal((await app.call('GET', '/api/envs/e/endpoints/worker/c')).body.handlerVia.length, 2);
  const t = (await app.call('GET', '/api/envs/e/trace?service=worker&ingress=c')).body;
  assert.equal(t.messages[0].handlerVia.length, 2);
  assert.equal((await app.call('GET', '/api/envs/e/views/service/api')).body.ingress[0].via.length, 0);
});
