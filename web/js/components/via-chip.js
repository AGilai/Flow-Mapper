// "via SNSManager.publish": the wrapper a call goes through, as one compact chip. Hover shows the
// chain as text; expanding lists every hop with a link to its code. The call itself is still one
// call: hops are never shown as separate producers or edges.

import { h } from '../dom.js';
import { icon } from '../icons.js';

const loc = (x) => (x.file ? `${x.file}${x.line ? ':' + x.line : ''}` : '');

/** hops: [{function, file?, line?, link?}] from the caller to the SDK call (as the API returns them). Null when empty. */
export function viaChip(hops) {
  if (!hops?.length) return null;
  const last = hops[hops.length - 1];
  const chain = hops.map((x) => x.function).join(' → ');
  return h('details.via-chip', { title: `via ${chain}` },
    h('summary', 'via ', h('span.key', last.function), hops.length > 1 ? h('span.via-n', `${hops.length} hops`) : null),
    h('ol.via-hops', hops.map((x) => h('li',
      h('span.key', x.function),
      x.link?.url
        ? h('a.at-link', { href: x.link.url, target: '_blank', rel: 'noopener noreferrer', title: loc(x) }, h('span.via-loc', loc(x)), icon('external'))
        : (loc(x) ? h('span.via-loc', loc(x)) : null)))));
}

/** Call sites of one egress, each with its own chip, collapsed under "N call sites". */
export function callSitesList(sites) {
  if (!sites?.length) return null;
  return h('details.via-sites',
    h('summary', `${sites.length} call ${sites.length === 1 ? 'site' : 'sites'}`),
    sites.map((c) => h('div.via-site',
      c.link?.url
        ? h('a.at-link', { href: c.link.url, target: '_blank', rel: 'noopener noreferrer' }, h('span.via-loc', `${c.file}${c.line ? ':' + c.line : ''}`), icon('external'))
        : h('span.via-loc', `${c.file}${c.line ? ':' + c.line : ''}`),
      c.function ? h('span.key', c.function) : null,
      viaChip(c.via))));
}
