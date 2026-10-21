// Status marks of a design environment: New (a spark: 4-point star), Changed (a ring with a dot), Removed (muted, struck through).
// Shapes carry the meaning, never the colour alone. Pure label helpers (markLabel, markTitle) are testable without a DOM.

import { h, s } from '../dom.js';
import { GLYPH } from '../icons.js';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n) => String(n).padStart(2, '0');

/** "Oct 21 14:02" (UTC) from an ISO timestamp; '' when it is not one. */
export function shortDateTime(iso) {
  const d = new Date(iso ?? '');
  return Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

const WORD = { new: 'New', changed: 'Changed', removed: 'Removed' };

/**
 * The badge text of a mark. `store` is a marks store (createMarks): comparing with the source now, an item that exists only in
 * the source reads "only in <source>" (not "Removed"): the design did not remove it, it never had it.
 */
export function markLabel(info, store) {
  if (info?.mark === 'removed' && store?.against === 'source') return `only in ${store.source ?? 'the source'}`;
  return WORD[info?.mark] ?? '';
}

/** The tooltip: "New since baseline prod, Oct 21 14:02" or, against the source, "Changed compared with prod now". */
export function markTitle(info, store) {
  if (!info) return '';
  const src = store?.source ?? 'the source';
  if (store?.against === 'source') return info.mark === 'removed' ? `Exists only in ${src} now` : `${WORD[info.mark]} compared with ${src} now`;
  const at = shortDateTime(store?.baselineAt);
  return `${WORD[info.mark]} since baseline ${src}${at ? ', ' + at : ''}`;
}

/** The CSS class of a mark: new | chg | rm. */
export const markClass = (info) => ({ new: 'new', changed: 'chg', removed: 'rm' })[info?.mark] ?? '';

/** The glyph as an <svg> (HTML). Removed has none. */
export function glyph(kind, size = 11) {
  const g = GLYPH[kind === 'changed' ? 'chg' : kind];
  if (!g) return null;
  return h('svg.mark-glyph', { svg: true, viewBox: '0 0 12 12', width: size, height: size, 'aria-hidden': 'true', class: g.fill ? 'star' : 'ring' }, s('path', { d: g.d, 'fill-rule': 'evenodd' }));
}

/** A badge: glyph + word. info = {mark, what?, was?}. */
export function markBadge(info, { store = null, title = null, short = false } = {}) {
  if (!info) return null;
  return h(`span.mark.${markClass(info)}`, { title: title ?? markTitle(info, store) }, glyph(info.mark), short ? null : markLabel(info, store));
}

/** "1 new" / "2 changed" badges for a section title: infos is a list of MarkInfo | null. */
export function countBadges(infos, store = null) {
  return ['new', 'changed'].map((k) => [k, infos.filter((i) => i?.mark === k).length]).filter(([, n]) => n)
    .map(([k, n]) => h(`span.mark.${markClass({ mark: k })}`, { title: markTitle({ mark: k }, store) }, glyph(k), `${n} ${k}`));
}

/** The "what changed" words next to a mark: `+1 endpoint`, or `was string`. */
export const wasText = (info) => info?.was ?? info?.what ?? '';

/** The spark / ring as an SVG <g> at (x, y) for drawings (flow heads, arrows). kind: 'new' | 'changed'. */
export function sparkSvg(x, y, kind, size = 12) {
  const g = GLYPH[kind === 'changed' ? 'chg' : 'new'], k = size / 12;
  return s('g', { class: `spark ${kind === 'changed' ? 'chg' : 'new'}`, transform: `translate(${x - size / 2},${y - size / 2}) scale(${k})` },
    s('path', { d: g.d, 'fill-rule': 'evenodd' }));
}
