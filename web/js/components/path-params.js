// "Path parameters" card for a REST ingress (#98): name, type (muted) and, when the harvester gave
// it, the file:line where the parameter is read as a code link. Null when the route has none.

import { h } from '../dom.js';
import { icon } from '../icons.js';

export function pathParamsCard(params) {
  if (!params?.length) return null;
  return h('section.ep-card', { 'data-qa': 'path-params' },
    h('header', h('h3', 'Path parameters'), h('span.ep-meta', String(params.length))),
    h('ul.ep-params', { style: { listStyle: 'none', margin: 0, padding: 0 } }, params.map(paramRow)));
}

function paramRow(p) {
  const loc = p.source?.file ? `${p.source.file}${p.source.line ? ':' + p.source.line : ''}` : null;
  const code = loc && (p.link?.url
    ? h('a.ep-link', { href: p.link.url, target: '_blank', rel: 'noopener noreferrer', title: p.link.url }, h('span.ep-link-text', h('span.key', loc)), icon('external'))
    : h('span.key.muted', loc));
  return h('li.ep-pad.row', { style: { gap: 'var(--s2)', alignItems: 'baseline', flexWrap: 'wrap' } },
    h('b.mono', p.name), p.type ? h('span.small.muted', p.type) : null, code);
}
