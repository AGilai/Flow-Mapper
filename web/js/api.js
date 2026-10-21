// Data access. Talks to the server, or — in the static preview build — to api-local.js,
// which runs the same core/ modules in the browser against bundled data.

import { state } from './state.js';

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

/** Reads of the current design environment as the open draft would leave it: `draft=<slug>` on every GET under /api/envs/<env>/ (not the draft routes). */
export function withDraft(path, draft = state.draft, env = state.env) {
  if (!draft || !path.startsWith(`/api/envs/${e(env)}/`) || /\/drafts(\/|\?|$)/.test(path)) return path;
  return path + (path.includes('?') ? '&' : '?') + `draft=${e(draft)}`;
}
const get = (path) => http('GET', withDraft(path));
const put = (env, tail, method, body) => http(method, `/api/envs/${e(env)}/drafts${tail}`, body);

const remote = {
  version: () => http('GET', '/api/version'),
  envs: () => http('GET', '/api/envs'),
  envMeta: () => http('GET', '/api/envs/meta'),
  envComponents: (env) => get(`/api/envs/${e(env)}/components`),
  neighbours: (env, services) => get(`/api/envs/${e(env)}/neighbours${qs({ services: services.join(',') })}`),
  createEnv: (body) => http('POST', '/api/envs', body),
  services: (env) => get(`/api/envs/${e(env)}/services`),
  system: (env) => get(`/api/envs/${e(env)}/views/system`),
  service: (env, name) => get(`/api/envs/${e(env)}/views/service/${e(name)}`),
  entryPoints: (env) => get(`/api/envs/${e(env)}/entry-points`),
  flowCounts: (env) => get(`/api/envs/${e(env)}/flows/counts`),
  inventory: (env) => get(`/api/envs/${e(env)}/inventory`),
  store: (env, key) => get(`/api/envs/${e(env)}/stores/${e(key)}`),
  instance: (env, id) => get(`/api/envs/${e(env)}/instances/${e(id)}`),
  instanceKeys: (env, id, f = {}) => get(`/api/envs/${e(env)}/resources/${e(id)}/keys${qs({ db: f.db, q: f.q, problems: f.problems ? 1 : null, service: f.service })}`),
  clients: (env, f = {}) => get(`/api/envs/${e(env)}/clients${qs(f)}`),
  channel: (env, key) => get(`/api/envs/${e(env)}/channels/${e(key)}`),
  eventType: (env, type) => get(`/api/envs/${e(env)}/events/${e(type)}`),
  endpoint: (env, service, ingress) => get(`/api/envs/${e(env)}/endpoints/${e(service)}/${e(ingress)}`),
  trace: (env, q) => get(`/api/envs/${e(env)}/trace${qs(q)}`),
  descriptions: (env, service, ingress) => get(`/api/envs/${e(env)}/descriptions${qs({ service, ingress })}`),
  putDescription: (env, body) => http('PUT', `/api/envs/${e(env)}/descriptions`, body),
  paths: (env, from, to) => get(`/api/envs/${e(env)}/paths${qs({ from, to })}`),
  search: (env, q, limit = 30) => get(`/api/envs/${e(env)}/search${qs({ q, limit })}`),
  health: (env) => get(`/api/envs/${e(env)}/health`),
  changelog: (env, service, limit = 20) => get(`/api/envs/${e(env)}/changelog${qs({ service, limit })}`),
  marks: (env, against) => get(`/api/envs/${e(env)}/marks${qs({ against: against === 'source' ? 'source' : null })}`),
  drafts: (env) => http('GET', `/api/envs/${e(env)}/drafts`),
  createDraft: (env, name, createdBy) => put(env, '', 'POST', { name, createdBy }),
  draftChanges: (env, slug) => http('GET', `/api/envs/${e(env)}/drafts/${e(slug)}/changes`),
  renameDraft: (env, slug, name) => put(env, `/${e(slug)}`, 'PATCH', { name }),
  editDraft: (env, slug, ops, author) => put(env, `/${e(slug)}/ops`, 'POST', { ops, author }),
  undoDraft: (env, slug) => put(env, `/${e(slug)}/ops/last`, 'DELETE'),
  revertDraftItem: (env, slug, anchor) => put(env, `/${e(slug)}/ops${qs({ anchor })}`, 'DELETE'),
  applyDraft: (env, slug, by) => put(env, `/${e(slug)}/apply`, 'POST', { by }),
  discardDraft: (env, slug, by) => put(env, `/${e(slug)}${qs({ by })}`, 'DELETE'),
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
  get: (_, name) => async (...args) => {
    if (!PREVIEW) return remote[name](...args);
    const be = await backend();
    be.readAs(state.env, state.draft); // the preview backend reads the open draft's overlay, like `?draft=` on the server
    return be.api[name](...args);
  },
});
export const attachmentUrl = (id, aid) => (PREVIEW ? null : remote.attachmentUrl(id, aid));
export const isPreview = PREVIEW;
