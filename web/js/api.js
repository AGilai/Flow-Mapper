// Data access. Talks to the server, or — in the static preview build — to api-local.js,
// which runs the same core/ modules in the browser against bundled data.

import { state } from './state.js';
import { currentId } from './users/me.js';

const PREVIEW = !!globalThis.FLOW_PREVIEW;
let local = null;
const backend = async () => (local ??= await import('./api-local.js'));

async function http(method, path, body, raw) {
  const res = await fetch(path, {
    method,
    headers: { ...(currentId() ? { 'x-flow-user': currentId() } : {}), ...(body === undefined ? {} : { 'content-type': raw ? raw.type || 'application/octet-stream' : 'application/json' }) },
    body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new Error(data?.error?.message ?? `HTTP ${res.status}`);
    err.status = res.status;
    err.details = data?.error?.details;
    err.code = data?.error?.code;
    throw err;
  }
  return data;
}

/** A GET that answers text (a Mermaid export): the body as a string; an error comes back as JSON like the others. */
async function httpText(path) {
  const res = await fetch(path, currentId() ? { headers: { 'x-flow-user': currentId() } } : undefined), text = await res.text();
  if (res.ok) return text;
  let data = null; try { data = JSON.parse(text); } catch { /* not JSON */ }
  const err = new Error(data?.error?.message ?? `HTTP ${res.status}`);
  err.status = res.status; err.code = data?.error?.code; err.details = data?.error?.details;
  throw err;
}

const e = encodeURIComponent;
const qs = (o) => {
  const p = new URLSearchParams(Object.entries(o).filter(([, v]) => v != null && v !== '' && v !== false));
  return p.toString() ? '?' + p : '';
};

/** Reads of the current design environment as the open draft would leave it: `draft=<slug>` on every GET under /api/envs/<env>/ (not the draft routes).
 *  The draft belongs to `env` (the page's): a read of another environment's path (a flow tab of another env, 0.36.0) never carries it. */
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
  putEnvColor: (env, color) => http('PUT', `/api/envs/${e(env)}/color`, { color }),
  services: (env) => get(`/api/envs/${e(env)}/services`),
  system: (env) => get(`/api/envs/${e(env)}/views/system`),
  service: (env, name) => get(`/api/envs/${e(env)}/views/service/${e(name)}`),
  entryPoints: (env) => get(`/api/envs/${e(env)}/entry-points`),
  openQuestions: (env) => get(`/api/envs/${e(env)}/open-questions`),
  flowsThrough: (env, services) => get(`/api/envs/${e(env)}/flows-through${qs({ service: services.join(',') })}`),
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
  draft: (env, slug) => http('GET', `/api/envs/${e(env)}/drafts/${e(slug)}`),
  draftChanges: (env, slug) => http('GET', `/api/envs/${e(env)}/drafts/${e(slug)}/changes`),
  renameDraft: (env, slug, name) => put(env, `/${e(slug)}`, 'PATCH', { name }),
  editDraft: (env, slug, ops, author) => put(env, `/${e(slug)}/ops`, 'POST', { ops, author }),
  undoDraft: (env, slug) => put(env, `/${e(slug)}/ops/last`, 'DELETE'),
  revertDraftItem: (env, slug, anchor) => put(env, `/${e(slug)}/ops${qs({ anchor })}`, 'DELETE'),
  applyDraft: (env, slug, by) => put(env, `/${e(slug)}/apply`, 'POST', { by }),
  importPreview: (env, slug, i) => http('GET', `/api/envs/${e(env)}/drafts/${e(slug)}/import/preview${qs({ source: i.source, anchor: i.anchor, groupPath: i.groupPath })}`),
  importIntoDraft: (env, slug, i, author) => put(env, `/${e(slug)}/import`, 'POST', { ...i, author }),
  mermaid: (env, service, ingress) => httpText(withDraft(`/api/envs/${e(env)}/flows/mermaid${qs({ service, ingress })}`)),
  mermaidPreview: (env, slug, body) => put(env, `/${e(slug)}/mermaid/preview`, 'POST', body),
  mermaidImport: (env, slug, body, author) => put(env, `/${e(slug)}/mermaid`, 'POST', { ...body, author }),
  undoMermaid: (env, slug, batch) => put(env, `/${e(slug)}/mermaid/${e(batch)}`, 'DELETE'),
  designEdit: (env, slug, edit, author) => put(env, `/${e(slug)}/edits`, 'POST', { edit, author }),
  subsystems: (env) => get(`/api/envs/${e(env)}/subsystems`),
  subsystemMap: (env) => get(`/api/envs/${e(env)}/views/subsystems`),
  abstractLinks: (env, subsystem) => get(`/api/envs/${e(env)}/abstract-links${qs({ subsystem })}`),
  abstractLink: (env, id) => get(`/api/envs/${e(env)}/abstract-links/${e(id)}`),
  putSubsystems: (env, subsystems, author) => http('PUT', `/api/envs/${e(env)}/subsystems`, { subsystems, author }),
  putLevels: (env, levels) => http('PUT', `/api/envs/${e(env)}/levels`, { levels }),
  flowRelations: (env, q = {}) => get(`/api/envs/${e(env)}/flow-relations${qs({ service: q.service, ingress: q.ingress, type: q.type })}`),
  planLinks: (env, slug, from, author) => put(env, `/${e(slug)}/plan/links`, 'POST', { from, author }),
  call: (env, service, egress) => get(`/api/envs/${e(env)}/call${qs({ service, egress })}`),
  flowNames: (env) => get(`/api/envs/${e(env)}/flow-names`),
  comments: (env, anchor) => get(`/api/envs/${e(env)}/comments${qs({ anchor })}`),
  commentCounts: (env) => get(`/api/envs/${e(env)}/comments/counts`),
  addComment: (env, body) => http('POST', `/api/envs/${e(env)}/comments${qs({ draft: state.draft })}`, body),
  editComment: (env, id, body) => http('PATCH', `/api/envs/${e(env)}/comments/${id}`, body),
  resolveComment: (env, id, body) => http('PATCH', `/api/envs/${e(env)}/comments/${id}`, body), // { actor, resolved } (0.29.2)
  deleteComment: (env, id, author) => http('DELETE', `/api/envs/${e(env)}/comments/${id}${qs({ author })}`),
  notes: (env, anchor, version) => get(`/api/envs/${e(env)}/notes${qs({ anchor, version })}`), // 0.34.0: a flow's Notes, kept as versions
  notesHistory: (env, anchor) => get(`/api/envs/${e(env)}/notes/history${qs({ anchor })}`),
  saveNotes: (env, body) => http('PUT', `/api/envs/${e(env)}/notes${qs({ draft: state.draft })}`, body), // { anchor, body, baseVersion, author }
  restoreNotes: (env, body) => http('POST', `/api/envs/${e(env)}/notes/restore${qs({ draft: state.draft })}`, body),
  actionItems: (env, anchor) => get(`/api/envs/${e(env)}/action-items${qs({ anchor })}`),
  actionCounts: (env) => get(`/api/envs/${e(env)}/action-items/counts`),
  addActionItem: (env, body) => http('POST', `/api/envs/${e(env)}/action-items${qs({ draft: state.draft })}`, body),
  editActionItem: (env, id, body) => http('PATCH', `/api/envs/${e(env)}/action-items/${id}${qs({ draft: state.draft })}`, body),
  deleteActionItem: (env, id, actor) => http('DELETE', `/api/envs/${e(env)}/action-items/${id}${qs({ actor })}`),
  mentions: (q = {}) => http('GET', `/api/mentions${qs({ user: q.user, unread: q.unread ? 1 : null, env: q.env, anchor: q.anchor, limit: q.limit })}`),
  seenMentions: (user, commentIds) => http('POST', '/api/mentions/seen', { user, commentIds }),
  mentionCounts: (env, user) => http('GET', `/api/envs/${e(env)}/mentions/counts${qs({ user })}`),
  users: () => http('GET', '/api/users'),
  user: (id) => http('GET', `/api/users/${e(id)}`),
  createUser: (body) => http('POST', '/api/users', body),
  renameUser: (id, body) => http('PATCH', `/api/users/${e(id)}`, body),
  mergeUser: (id, into) => http('POST', `/api/users/${e(id)}/merge`, { into }),
  setFlowName: (env, body) => http('PUT', `/api/envs/${e(env)}/flow-names`, body),
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
export const deleteEnv = (env) => (PREVIEW ? Promise.reject(new Error('Deleting an environment is not available in the preview: it needs the server.')) : http('DELETE', `/api/envs/${e(env)}`));
