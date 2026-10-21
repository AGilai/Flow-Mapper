// The map legend lines that only a design environment has: the marks, the removed components and "transport not decided".

import { h } from '../dom.js';
import { GLYPH } from '../icons.js';

const glyphSvg = (k) => `<svg width="14" height="14" viewBox="0 0 12 12"><path d="${GLYPH[k].d}" fill-rule="evenodd" fill="${k === 'new' ? 'var(--new)' : 'var(--new-ink)'}" stroke="${k === 'new' ? 'var(--new-ink)' : 'none'}" stroke-width=".9" stroke-linejoin="round"/></svg>`;

/** markLegend(item, marks, data) -> legend items (only what is drawn). `item(svg, label)` is the legend's own builder. */
export function markLegend(item, marks, data) {
  const out = [];
  const kinds = new Set(marks.components().map((c) => c.mark));
  if (kinds.has('new')) out.push(item(glyphSvg('new'), 'New in this design'));
  if (kinds.has('changed')) out.push(item(glyphSvg('chg'), 'Changed (what changed is written under it)'));
  const gone = marks.ghostsUnder('svc:').map((g) => g.label || g.anchor.slice(4));
  if (gone.length) out.push(h('span.legend-item', { style: { textDecoration: 'line-through', color: 'var(--muted)' } }, `Removed: ${gone.join(', ')}`));
  if (data.edges.some((e) => e.transports?.includes('undecided'))) out.push(item('<svg width="22" height="6"><path d="M1 3h20" stroke="var(--ink-2)" stroke-width="1.6"/></svg>', 'Transport not decided'));
  return out;
}
