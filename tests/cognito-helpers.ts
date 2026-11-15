// Test kit for cognito mode: the app wired to a fake Cognito (tests/fake-idp.ts), a cookie-holding browser session per person, bearer clients,
// and the samples ingested through a harvester token.

import { startApp, sampleManifests } from './helpers.ts';
import { startIdp } from './fake-idp.ts';
import type { AuthOptions } from '../server/auth/options.ts';

type App = Awaited<ReturnType<typeof startApp>>;
export interface Client { call: (method: string, path: string, body?: unknown, headers?: Record<string, string>) => Promise<{ status: number; body: any; headers: Headers }>; mcp: (tool: string, args?: any) => Promise<{ isError: boolean; text: string; json: any }> }

function client(base: string, headersOf: () => Record<string, string>): Client {
  const call: Client['call'] = async (method, path, body, headers = {}) => {
    const res = await fetch(base + path, { method, redirect: 'manual', headers: { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headersOf(), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  };
  const mcp: Client['mcp'] = async (tool, args = {}) => {
    const x = await call('POST', '/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } });
    if (x.status !== 200) return { isError: true, text: JSON.stringify(x.body), json: x.body };
    const { isError, content } = x.body.result;
    return { isError, text: content[0].text, json: isError ? null : JSON.parse(content[0].text) };
  };
  return { call, mcp };
}

export async function startCognito(extra: Partial<AuthOptions> = {}) {
  const idp = await startIdp();
  const auth: AuthOptions = { mode: 'cognito', issuer: idp.issuer, clientId: idp.clientId, domain: idp.base, jwksMinRefetchMs: 0, adminEmail: 'admin@example.com', publicUrl: 'pending', ...extra };
  const app: App = await startApp({ auth });
  const jar = (cookies: Map<string, string>) => () => ({ cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') });
  const eat = (cookies: Map<string, string>, res: Response) => { for (const c of res.headers.getSetCookie()) { const [kv] = c.split(';'); const i = kv.indexOf('='); if (/Max-Age=0/i.test(c)) cookies.delete(kv.slice(0, i)); else cookies.set(kv.slice(0, i), kv.slice(i + 1)); } };

  /** Signs in through /auth/login -> fake hosted UI -> /auth/callback, like a browser. */
  async function signIn(email: string, name?: string, sub = `sub-${email}`) {
    idp.setUser({ email, name: name ?? email.split('@')[0], sub });
    const cookies = new Map<string, string>();
    let res = await fetch(app.base + '/auth/login?returnTo=%2F%23%2Fflows', { redirect: 'manual' }); eat(cookies, res);
    res = await fetch(res.headers.get('location')!, { redirect: 'manual' });
    res = await fetch(res.headers.get('location')!, { redirect: 'manual', headers: jar(cookies)() }); eat(cookies, res);
    if (res.status !== 302) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
    const c = client(app.base, () => ({ ...jar(cookies)(), 'x-flows-csrf': cookies.get('fm_csrf') ?? '' }));
    const me = (await c.call('GET', '/api/me')).body;
    return { ...c, cookies, id: me.user.id as string, me, location: res.headers.get('location') };
  }
  const bearer = (token: string) => client(app.base, () => ({ authorization: `Bearer ${token}` }));
  const anon = client(app.base, () => ({}));
  /** A token for a signed-in person. */
  async function token(s: Awaited<ReturnType<typeof signIn>>, name = 't', extra: object = {}) {
    const r = await s.call('POST', '/api/tokens', { name, ...extra });
    if (r.status !== 201) throw new Error(`token: ${JSON.stringify(r.body)}`);
    return r.body as { token: string; id: string };
  }
  /** The admin, a harvester token for them, and the samples in prod. */
  async function seed() {
    const admin = await signIn('admin@example.com', 'Admin');
    const h = bearer((await token(admin, 'harvester', { scope: 'harvester' })).token);
    const r = await h.call('POST', '/api/ingest', { manifests: sampleManifests() });
    if (r.status !== 201) throw new Error(`seed: ${JSON.stringify(r.body)}`);
    return { admin, harvester: h };
  }
  return { ...app, idp, auth, signIn, bearer, anon, token, seed, close: async () => { await app.close(); await idp.close(); } };
}

/** A design env owned by `s` (blank copy). */
export async function makeDesign(s: { call: Client['call'] }, name: string) {
  const r = await s.call('POST', '/api/envs', { name, mode: 'blank' });
  if (r.status !== 201) throw new Error(`design: ${JSON.stringify(r.body)}`);
}
