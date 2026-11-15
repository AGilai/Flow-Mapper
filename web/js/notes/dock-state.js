// Whether the design doc is docked beside the work, per environment and per viewer (this browser). "Hidden" is the absence of the key or "0":
// nothing is drawn for it then. Pure over localStorage (try/catch: a browser without storage means hidden).

const key = (env) => `flow-mapper.design-dock:${env}`;
const subs = new Set();

export function isDocked(env) { try { return localStorage.getItem(key(env)) === '1'; } catch { return false; } }
export function setDocked(env, on) {
  try { if (on) localStorage.setItem(key(env), '1'); else localStorage.removeItem(key(env)); } catch { /* storage unavailable */ }
  subs.forEach((f) => f(env, !!on));
}
/** Call `fn(env, docked)` when the state changes; returns the way to stop. */
export function onDocked(fn) { subs.add(fn); return () => subs.delete(fn); }
