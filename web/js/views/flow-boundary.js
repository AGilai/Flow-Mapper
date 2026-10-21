// A copied endpoint (Components copy) came along without the functions behind it: tracing it says where its behaviour lives, with a link there.
// The server answers 409 NO_HANDLER with details {source, service, ingress}.

import { h } from '../dom.js';
import { href } from '../router.js';

/** The boundary notice for a trace error, or null when the error is something else. */
export function boundaryNote(err) {
  const d = err?.details;
  if (err?.status !== 409 || !d?.source || !d.ingress) return null;
  return h('div.content', h('div.info-note', { role: 'note', 'data-qa': 'boundary' },
    h('p', h('b', `This endpoint's behaviour lives in ${d.source}.`), ` This environment holds the endpoint ${d.service} ${d.ingress}, not the functions behind it, so there is no flow to draw here.`),
    h('a.btn', { href: href('/flows', { env: d.source, tabs: `${d.service}/${d.ingress}` }) }, `Open in ${d.source}`)));
}
