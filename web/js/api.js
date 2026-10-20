// Data access. Talks to the server, or — in the static preview build — to api-local.js,
// which runs the same core/ modules in the browser against bundled data.

const PREVIEW = !!globalThis.FLOW_PREVIEW;
let local = null;
const backend = async () => (local ??= await import('./api-local.js'));

async function http(method, path, body, raw) {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': raw ? raw.type || 'application/octet-stream' : 'application/json' },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `HTTP ${res.status}`);
    err.status = res.status;
    err.details = data?.error?.details;
    throw err;
  }
  return data;
}

const e = encodeURIComponent;
const qs = (o) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '' && v !== false));
  return p.toString() ? '?' + p : '';
};

const remote = {
  version: () => http('GET', '/api/version'),
  envs: () => http('GET', '/api/envs'),
  services: (env) => http('GET', `/api/envs/${e(env)}/services`),
  system: (env) => http('GET', `/api/envs/${e(env)}/views/system`),
  service: (env, name) => http('GET', `/api/envs/${e(env)}/views/service/${e(name)}`),
  entryPoints: (env) => http('GET', `/api/envs/${e(env)}/entry-points`),
  inventory: (env) => http('GET', `/api/envs/${e(env)}/inventory`),
  store: (env, key) => http('GET', `/api/envs/${e(env)}/stores/${e(key)}`),
  clients: (env, f = {}) => http('GET', `/api/envs/${e(env)}/clients${qs(f)}`),
  channel: (env, key) => http('GET', `/api/envs/${e(env)}/channels/${e(key)}`),
  eventType: (env, type) => http('GET', `/api/envs/${e(env)}/events/${e(type)}`),
  endpoint: (env, service, ingress) => http('GET', `/api/envs/${e(env)}/endpoints/${e(service)}/${e(ingress)}`),
  trace: (env, q) => http('GET', `/api/envs/${e(env)}/trace${qs(q)}`),
  paths: (env, from, to) => http('GET', `/api/envs/${e(env)}/paths${qs({ from, to })}`),
  search: (env, q, limit = 30) => http('GET', `/api/envs/${e(env)}/search${qs({ q, limit })}`),
  health: (env) => http('GET', `/api/envs/${e(env)}/health`),
  changelog: (env, service, limit = 20) => http('GET', `/api/envs/${e(env)}/changelog${qs({ service, limit })}`),
  bugs: (filter = {}) => http('GET', `/api/bugs${qs(filter)}`),
  bugStats: () => http('GET', '/api/bugs/stats'),
  bug: (id) => http('GET', `/api/bugs/${id}`),
  createBug: (b) => http('POST', '/api/bugs', b),
  updateBug: (id, patch) => http('PATCH', `/api/bugs/${id}`, patch),
  comment: (id, author, body) => http('POST', `/api/bugs/${id}/comments`, { author, body }),
  attach: (id, file) => http('POST', `/api/bugs/${id}/attachments?filename=${e(file.name)}`, file, file),
  attachmentUrl: (id, aid) => `/api/bugs/${id}/attachments/${aid}`,
};

export const api = new Proxy({}, {
  get: (_, name) => async (...args) => (PREVIEW ? (await backend()).api[name](...args) : remote[name](...args)),
});
export const attachmentUrl = (id, aid) => (PREVIEW ? null : remote.attachmentUrl(id, aid));
export const isPreview = PREVIEW;
