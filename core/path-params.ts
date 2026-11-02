// Path parameters of a REST ingress (#98): the harvested `pathParams`, else names derived from the
// placeholders in the route path ({p1}, {id}, :id). Pure; used by the server, the UI and the preview.

import type { Ingress, PathParam } from './types.ts';

/** Placeholders in a route path, in order: `{id}` and `:id` forms. A bare `{}` has no name and is skipped. */
export function placeholderNames(path: string): string[] {
  const out: string[] = [];
  for (const m of path.matchAll(/\{([^{}/]+)\}|(?:^|\/):([A-Za-z_]\w*)/g)) out.push((m[1] ?? m[2]).trim());
  return out;
}

/** The route path of an ingress: details.path, else the bind key (`http:GET host/api/x/{id}`) after the method and host. */
function routePath(i: Ingress): string {
  const p = (i.details as any)?.path;
  if (typeof p === 'string') return p;
  const rest = i.bindKey.replace(/^[a-z]+:/i, '').replace(/^[A-Za-z]+\s+/, '');
  const slash = rest.indexOf('/');
  return slash < 0 ? '' : rest.slice(slash);
}

/** Path parameters of a REST (http) ingress: the given list, else derived names without type or source. */
export function pathParamsOf(i: Ingress): PathParam[] {
  if (i.transport !== 'http') return [];
  if (i.pathParams?.length) return i.pathParams;
  return placeholderNames(routePath(i)).map((name) => ({ name }));
}
