// Hash router: #/path/segments?query. Works on a static host too (preview build).

const routes = [];
let current = null;

export function route(pattern, load) {
  routes.push({ parts: pattern.split('/').filter(Boolean), load });
}

export function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/system';
  const [path, qs = ''] = raw.split('?');
  return { path, parts: path.split('/').filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(qs) };
}

export function href(path, query) {
  const qs = query ? new URLSearchParams(Object.entries(query).filter(([, v]) => v != null && v !== '')).toString() : '';
  return `#${path}${qs ? '?' + qs : ''}`;
}

export const go = (path, query) => { location.hash = href(path, query).slice(1); };

/** Update the query string without re-rendering the view. */
export function setQuery(patch) {
  const { path, query } = parseHash();
  for (const [k, v] of Object.entries(patch)) (v == null || v === '' ? query.delete(k) : query.set(k, v));
  const qs = query.toString();
  history.replaceState(null, '', `#${path}${qs ? '?' + qs : ''}`);
}

export function start(onChange) {
  const run = async () => {
    const loc = parseHash();
    for (const r of routes) {
      if (r.parts.length !== loc.parts.length) continue;
      const params = {};
      if (r.parts.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = loc.parts[i]), true) : p === loc.parts[i]))) {
        current?.dispose?.();
        current = (await onChange(r, params, loc)) ?? null;
        return;
      }
    }
    location.hash = '/system';
  };
  addEventListener('hashchange', run);
  run();
}
