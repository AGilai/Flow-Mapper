// A copied endpoint (Components copy) came along without the functions behind it: tracing it says where its behaviour lives, with a link there.
// The server answers 409 NO_HANDLER with details {source, service, ingress, reference?, anchor?}. A reference (0.25.0) also offers
// "Import into design" in Edit with a draft: it opens the Import panel (design/import-panel.js).

import { h } from '../dom.js';
import { href } from '../router.js';
import { lockChip } from '../components/lock.js';

/** The boundary notice for a trace error, or null when the error is something else. `opts`: { editing, onImport(anchor, source) }. */
export function boundaryNote(err, { editing = false, onImport = null } = {}) {
  const d = err?.details;
  if (err?.status !== 409 || !d?.source || !d.ingress) return null;
  const ref = !!d.reference, anchor = d.anchor ?? `ing:${d.service}/${d.ingress}`;
  return h('div.content', h('div.info-note', { role: 'note', 'data-qa': 'boundary' },
    ref ? h('p', lockChip({ source: d.source })) : null,
    h('p', h('b', ref ? `This endpoint is a reference from ${d.source}.` : `This endpoint's behaviour lives in ${d.source}.`),
      ` This environment holds the endpoint ${d.service} ${d.ingress}, not the functions behind it, so there is no flow to draw here.`),
    h('div.row', { style: { gap: 'var(--s2)', flexWrap: 'wrap' } },
      ref && editing && onImport ? h('button.btn.primary', { type: 'button', 'data-qa': 'import-ref', on: { click: () => onImport(anchor, d.source) } }, 'Import into design') : null,
      h('a.btn', { href: href('/flows', { env: d.source, tabs: `${d.service}/${d.ingress}` }) }, `Open in ${d.source}`))));
}
