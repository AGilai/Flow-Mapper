// Who this browser is signed in as (0.31.0): the user id in localStorage (try/catch: storage may be missing), sent as `X-Flow-User` on
// every request (api.js). Naive sign-in: picking a user is the login; Cognito later replaces this one module and server/identity.ts.

const KEY = 'flow-mapper.user';
export const LEGACY = 'flow-mapper.reporter'; // the name the bug dialog and the composer remembered before users existed
const subs = new Set();
let memo = null; // when storage is unavailable the choice lasts until reload

export const currentId = () => { try { return localStorage.getItem(KEY) || memo; } catch { return memo; } };
export function setMyId(id) {
  memo = id || null;
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  subs.forEach((f) => f());
}
export const legacyName = () => { try { return localStorage.getItem(LEGACY) || ''; } catch { return ''; } };
export const onMe = (f) => { subs.add(f); return () => subs.delete(f); };
