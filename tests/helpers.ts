// Test helpers: start the app on a random port with a fresh database and the sample manifests.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.ts';
import type { StreamOptions } from '../server/routes/events.ts';

export const SAMPLES = join(import.meta.dirname, '../samples');
export const readSample = (name: string) => JSON.parse(readFileSync(join(SAMPLES, name), 'utf8'));
export const sampleManifests = () => readdirSync(SAMPLES).filter((f) => f.endsWith('.json')).sort().map(readSample);

/** The sample manifests as one in-memory model (env prod), for tests of core/ without a server. */
export function sampleModel(): any {
  const model: any = { env: 'prod', services: [], functions: [], ingress: [], egress: [], resources: [], channels: [], bindings: [] };
  for (const m of sampleManifests()) {
    model.services.push({ ...m.service, version: m.version, harvestedAt: m.harvestedAt });
    for (const l of ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings']) for (const e of m[l] ?? []) model[l].push({ ...e, service: m.service.name, ...(l === 'functions' ? { steps: e.steps ?? [] } : {}) });
  }
  return model;
}

export async function startApp(opts: { dir?: string; events?: StreamOptions } = {}) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), 'flow-mapper-test-'));
  const { server, ctx, router } = createApp({ dbPath: join(dir, 'test.db'), dataDir: dir, events: opts.events });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const isRaw = typeof body === 'string' || body instanceof Uint8Array;
    const res = await fetch(base + path, {
      method, headers: body === undefined ? headers : { 'content-type': isRaw ? 'text/plain' : 'application/json', ...headers },
      body: body === undefined ? undefined : isRaw ? (body as any) : JSON.stringify(body),
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json };
  };
  return { base, ctx, router, dbPath: join(dir, 'test.db'), call, close: () => new Promise<void>((r) => { server.close(() => { if (!opts.dir) rmSync(dir, { recursive: true, force: true }); r(); }); server.closeAllConnections(); }) }; // a temp dir made here goes with the app (they piled up to 5 GB in /tmp)
}

/** The app with the samples in prod and a design environment (Components copy of users-svc and auth-svc, subsystem platform). */
export async function startDesign(name = 'hld') {
  const app = await startApp();
  const r = await app.call('POST', '/api/ingest', { manifests: sampleManifests() });
  if (r.status !== 201) throw new Error(`seed ingest: ${JSON.stringify(r.body)}`);
  for (const f of readdirSync(join(SAMPLES, 'dtos')).filter((x) => x.endsWith('.json'))) {
    const { env, dtos } = readSample(`dtos/${f}`);
    const d = await app.call('POST', `/api/envs/${env}/dtos`, { dtos });
    if (d.status !== 201) throw new Error(`seed dtos: ${JSON.stringify(d.body)}`);
  }
  const e = await app.call('POST', '/api/envs', { name, source: 'prod', mode: 'components', groups: [{ key: 'platform', label: 'Platform' }, { key: 'agent', label: 'Agent' }],
    services: [{ name: 'users-svc', groupPath: 'platform' }, { name: 'auth-svc', groupPath: 'platform' }] });
  if (e.status !== 201) throw new Error(`copy: ${JSON.stringify(e.body)}`);
  const mcp = async (tool: string, args: any) => {
    const x = await app.call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } });
    const { isError, content } = x.body.result;
    return { isError: isError as boolean, text: content[0].text as string, json: isError ? null : JSON.parse(content[0].text) };
  };
  return { ...app, mcp, env: name };
}
