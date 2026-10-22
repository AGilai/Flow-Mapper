// "Removed in this draft" / "Removed since the baseline" / "Only in <source>": the items a design no longer has, under a flow diagram or a service's connections.
// They are ghosts of the marks (`egr:` of the services in view): muted and struck through, never red. Comparing with the source now, they read "only in <source>".

import { h } from '../dom.js';
import { href } from '../router.js';
import { envQuery } from './inventory-links.js';

/** The title of the list (pure): which wording fits what the marks compare with. */
export function removedTitle(marks, n, draft) {
  const src = marks.source ?? 'the source';
  if (marks.against === 'source') return `${n} ${n === 1 ? 'call' : 'calls'} only in ${src}`;
  return draft ? `${n} ${n === 1 ? 'call' : 'calls'} removed in this draft` : `${n} ${n === 1 ? 'call' : 'calls'} removed since the baseline`;
}

/** The ghosts of calls (`egr:`) whose caller is one of `services`. */
export const removedCalls = (marks, services) => services.flatMap((s) => marks.ghostsUnder(`egr:${s}/`));

/** removedList(marks, services, { draft, env }) -> the box, or null when nothing was removed. `env`: the flow's environment, for the links. */
export function removedList(marks, services, { draft = null, env = null } = {}) {
  const gone = removedCalls(marks, services);
  if (!gone.length) return null;
  return h('section.mk-removed', { 'data-qa': 'removed-list' }, h('h3', removedTitle(marks, gone.length, draft)),
    h('ul', gone.map((g) => h('li', g.service ? [h('a', { href: href(`/services/${encodeURIComponent(g.service)}`, envQuery(env)) }, g.service), ' calls '] : null, h('code.key', g.label)))));
}
