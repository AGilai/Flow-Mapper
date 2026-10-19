// A subscription's filter as the manifests declare it. Declarations of one subscription are merged
// into one block: when they agree, one filter and "declared by ..."; when they differ, one line per
// source with the differing value highlighted. See docs/UI-GUIDE.md §3.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { filterChips } from './event-chips.js';

/** Plain-language gloss for the provenance words. */
export const VERIFIED = { match: 'Live AWS matches code', drift: 'Live AWS differs from this code', 'code-only': 'Not checked against live AWS' };

const srcLabel = (at) => `${(at.file ?? 'source').split('/').pop()}${at.line ? ':' + at.line : ''}`;
/** "tf:22": the file type and line, for tight places. */
const shortLabel = (at) => `${(at.file ?? '').split('.').length > 1 ? at.file.split('.').pop() : 'src'}${at.line ? ':' + at.line : ''}`;
const source = (d, short = false) => (d.at?.url ? [' ', h('a', { href: d.at.url, target: '_blank', rel: 'noopener noreferrer', title: `${srcLabel(d.at)}, ${d.at.url}` }, short ? shortLabel(d.at) : srcLabel(d.at))] : null);

function declaredBy(decls) {
  return h('div.who', 'declared by ', decls.map((d, i) => [i ? ', ' : '', d.service, source(d)]));
}

/** `filter` is a flow row's `filter` (see docs/API.md, channels). */
export function declaration(filter) {
  if (filter.agree) {
    const verified = [...new Set(filter.declarations.map((d) => d.verified).filter(Boolean))];
    return h('div.decl', filterChips(filter.events), declaredBy(filter.declarations),
      verified.length ? h('div.who', verified.map((v) => VERIFIED[v]).join('; ')) : null);
  }
  const n = filter.declarations.length;
  return h('div.decl.disagree',
    h('div.decl-tag', icon('health'), `${n} declarations disagree on the filter`),
    filter.declarations.map((d) => h('div.claim',
      h('span.src', d.service, source(d, true)),
      h('span.val', filterChips(d.events, { limit: 3, cls: 'diff', nowrap: d.events === '*' || d.events.length <= 2 }), Array.isArray(d.events) && !d.events.some((e) => e.startsWith('!')) ? h('span.who', 'only') : null),
      d.verified ? h('span.note', VERIFIED[d.verified]) : null)));
}
