// Test helpers: start the app on a random port with a fresh database and the sample manifests.

import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createApp } from '../server/app.ts';

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

export async function startApp() {
  const dir = mkdtempSync(join(tmpdir(), 'flow-mapper-test-'));
  const { server, ctx, router } = createApp({ dbPath: join(dir, 'test.db'), dataDir: dir });
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
  return { base, ctx, router, dbPath: join(dir, 'test.db'), call, close: () => new Promise<void>((r) => server.close(() => r())) };
}
