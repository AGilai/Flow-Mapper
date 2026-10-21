// App-wide state: current environment and app version. Persists the env choice per browser.

const KEY = 'flow-mapper.env';
const listeners = new Set();

export const state = {
  env: (() => { try { return localStorage.getItem(KEY); } catch { return null; } })(),
  envs: [],
  /** [{name, kind, source, copiedAt, groups, levels, counts}] from GET /api/envs/meta (the rail shows kind and counts). */
  envMeta: [],
  version: '',
};

/** Switch environment; `silent` skips the page refresh (the caller navigates next). */
export function setEnv(env, silent = false) {
  state.env = env;
  try { localStorage.setItem(KEY, env); } catch { /* storage unavailable */ }
  if (!silent) listeners.forEach((fn) => fn());
}

export const onEnvChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
