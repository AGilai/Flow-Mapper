// #149: path parameter names on arrows. `namedPath` mirrors core/path-params.ts (no imports here: node tests load this file; tests/path-params-named.test.ts keeps them equal).
export function namedPath(path, params) {
  if (!params?.length) return path;
  const re = /\{[^{}/]*\}|(^|\/):[A-Za-z_]\w*/g;
  if ((path.match(re) ?? []).length !== params.length) return path;
  let n = 0;
  return path.replace(re, (_m, slash) => `${slash ?? ''}{${params[n++].name}}`);
}

// The tooltip lines of an arrow that reaches an http route with harvested path parameters: name and type.
export const paramTitle = (m) => (m?.pathParams?.length ? `\nPath parameters: ${m.pathParams.map((p) => (p.type ? `${p.name} (${p.type})` : p.name)).join(', ')}` : '');

/** #149: the entry route's path parameters for a step of the entry request: a step of the entry service's own handling (middleware, handler,
 *  its data access) before the first call out or delivery. A step that reaches its own route shows that route's card (loaded from the endpoint). */
export function entryParamsFor(m, trace) {
  const ms = trace.messages, entry = ms[0];
  if (m.target || !entry?.pathParams?.length || entry.kind !== 'entry') return null;
  const at = ms.indexOf(m);
  if (at < 1) return null;
  for (let i = 1; i < at; i++) if (ms[i].kind === 'egress' || ms[i].kind === 'deliver') return null;
  return m.service && entry.service && m.service !== entry.service ? null : entry.pathParams;
}
