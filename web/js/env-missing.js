// A link can name an environment created after this page loaded (the client's list is stale). The decision is pure: which name does the URL
// ask for, and is it unknown to the list we have? main.js refetches the list once, and only shows "No environment" if it is still unknown.

/** The environment a URL asks for: `?env=` or, for `#/envs/<name>/settings`, the name in the path. null when it names none. */
export function requestedEnv(query, parts = [], params = {}) {
  const q = query?.get?.('env');
  if (q) return q;
  return parts[0] === 'envs' && params.name && params.name !== 'new' ? params.name : null;
}

/** The name to look up again (the URL asks for an environment the list does not have), or null. */
export const unknownEnv = (want, envs) => (want && !envs.includes(want) ? want : null);
