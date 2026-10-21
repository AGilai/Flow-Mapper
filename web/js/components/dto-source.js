// Small provenance line under a DTO: where it was derived from (file:line, linked when the repo is
// known), how, and "incomplete" when the harvester flagged it as partial. Nothing when there is no meta.

import { h } from '../dom.js';

export function dtoSource(dto) {
  const m = dto?.meta;
  if (!m) return null;
  const s = m.source;
  const loc = s?.file ? `${s.file}${s.line ? ':' + s.line : ''}` : s?.repo;
  const where = !loc ? null
    : dto.link?.url ? h('a', { href: dto.link.url, target: '_blank', rel: 'noopener noreferrer', title: dto.link.url }, h('span.key', loc))
    : h('span.key', loc);
  const ref = s?.ref ? ` at ${s.ref.length > 12 ? s.ref.slice(0, 8) : s.ref}` : '';
  const reason = typeof m.incomplete === 'string' ? m.incomplete : null;
  if (!where && !m.provenance && !m.incomplete) return null;
  return h('div.dto-source',
    where ? h('span', 'Source ', where, ref) : null,
    m.provenance ? h('span', `provenance: ${m.provenance}`) : null,
    m.incomplete ? h('span.pill.warn', { title: reason ?? 'The harvester could not capture every field' }, 'incomplete') : null,
    reason ? h('span', reason) : null);
}
