// App-wide state: current environment and app version. Persists the env choice per browser.

const KEY = 'flow-mapper.env';
const listeners = new Set();

export const state = {
  env: (() => { try { return localStorage.getItem(KEY); } catch { return null; } })(),
  envs: [],
  version: '',
};

export function setEnv(env) {
  state.env = env;
  try { localStorage.setItem(KEY, env); } catch { /* storage unavailable */ }
  listeners.forEach((fn) => fn());
}

export const onEnvChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
