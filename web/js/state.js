// App-wide state: current environment, app version and the design-environment view state (mode, draft, compare).
// The design state lives in the URL (`mode=edit`, `draft=<slug>`, `compare=source`) so links land in a draft; the env choice is kept per browser.

import { setQuery, parseHash } from './router.js';
import { urlKeys, retarget } from './views/flow-tabs-state.js';

const KEY = 'flow-mapper.env';
const listeners = new Set();

export const state = {
  env: (() => { try { return localStorage.getItem(KEY); } catch { return null; } })(),
  envs: [],
  /** [{name, kind, source, copiedAt, groups, levels, counts}] from GET /api/envs/meta (the rail shows kind and counts). */
  envMeta: [],
  version: '',
  /** 'view' | 'edit' (edit only on design envs), the open draft's slug, and what marks compare with ('baseline' | 'source'). */
  mode: 'view',
  draft: null,
  compare: 'baseline',
};

const DESIGN_KEYS = { mode: 'view', draft: null, compare: 'baseline' };

/** Is `name` a design environment? (Only those have drafts, Edit and marks.) */
export const isDesign = (name = state.env, meta = state.envMeta) => meta.some((m) => m.name === name && m.kind === 'design');

/** The query parameters that carry the design state; defaults are left out. */
export function designQuery(s = state) {
  return { env: s.draft || s.mode === 'edit' ? s.env : null, draft: s.draft || null, mode: s.mode === 'edit' ? 'edit' : null, compare: s.compare === 'source' ? 'source' : null };
}

/**
 * Read env / mode / draft / compare from a URL query (URLSearchParams) into a plain object of what changed.
 * A parameter that is absent keeps the current value, except that switching env clears the design state. Sealed envs are always view, no draft.
 */
export function designFromQuery(query, s = state, envs = s.envs, meta = s.envMeta) {
  const env = query.get('env') && envs.includes(query.get('env')) ? query.get('env') : s.env;
  const switched = env !== s.env;
  const base = switched ? { ...DESIGN_KEYS } : { mode: s.mode, draft: s.draft, compare: s.compare };
  if (!isDesign(env, meta)) return { env, ...DESIGN_KEYS };
  const draft = query.has('draft') ? query.get('draft') || null : base.draft;
  const mode = query.get('mode') === 'edit' ? 'edit' : query.has('mode') ? 'view' : base.mode;
  const compare = query.get('compare') === 'source' ? 'source' : query.has('compare') ? 'baseline' : base.compare;
  return { env, draft, mode, compare };
}

/** The tabs of the URL in the terms of another environment (0.36.0): an unprefixed key means the page's environment, so a switch has to write the old one's tabs with their prefix. */
function tabsPatch(from, to) {
  try { const q = parseHash().query; return urlKeys(q).length ? retarget(q, from, to) : {}; } catch { return {}; }
}

/** Switch environment; `silent` skips the page refresh (the caller navigates next, and the URL is already in the new environment's terms). Clears the design state; open flow tabs stay. */
export function setEnv(env, silent = false) {
  const tabs = silent || env === state.env ? {} : tabsPatch(state.env, env);
  state.env = env;
  Object.assign(state, DESIGN_KEYS);
  setQuery({ env: null, draft: null, mode: null, compare: null, ...tabs });
  try { localStorage.setItem(KEY, env); } catch { /* storage unavailable */ }
  if (!silent) listeners.forEach((fn) => fn());
}

/** Change mode / draft / compare, write them to the URL and refresh the page. */
export function setDesign(patch) {
  Object.assign(state, patch);
  if (state.mode === 'edit' && !isDesign()) state.mode = 'view';
  setQuery(designQuery());
  listeners.forEach((fn) => fn());
}

export const onEnvChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
