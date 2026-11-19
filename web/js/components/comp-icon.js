// A component's own icon (CR #144, frame 32): `details.icon`, drawn left of its name. The mark is never recoloured; a plain tile sits behind it only where frame 32 says
// (core/component-icons.ts `iconTile`: Vault slate, Kafka and MySQL white in dark mode only, a user's logo white). Every icon is an <img> / <image> with a URL
// (a user's SVG as a data: URL), so a user's file is never injected as markup and never runs. The picture is decorative: empty alt, the name is the label.
//   compIcon(value, size) -> HTML node (heads of lists, the Info pane, the picker)    compIconSvg(value, x, y, size) -> <g> for the sequence diagram

import { h, s } from '../dom.js';
import { iconSrc, iconTile } from './icon-src.js';

const TILE_CLASS = { slate: 'ci-slate', 'white-dark': 'ci-wd', white: 'ci-white' };

/** A tile adds 2px around the mark: the outer box is `size + 2`, the mark `size - 2`. Without a tile the mark is `size`. */
export function compIcon(value, size = 14) {
  const src = iconSrc(value), tile = iconTile(value);
  if (!src) return null;
  const outer = tile ? size + 2 : size, inner = tile ? size - 2 : size;
  const img = h('img.ci-img', { src, alt: '', width: inner, height: inner, draggable: false, decoding: 'async' });
  const el = h(`span.ci${tile ? `.${TILE_CLASS[tile]}` : ''}`, { 'aria-hidden': 'true', style: { width: `${outer}px`, height: `${outer}px` } }, img);
  return el;
}

/** The icon for an SVG drawing, its box top-left at (x, y); a tile is a rect the stylesheet paints (so dark mode needs no redraw). */
export function compIconSvg(value, x, y, size = 14) {
  const src = iconSrc(value), tile = iconTile(value);
  if (!src) return null;
  const outer = tile ? size + 2 : size, inner = tile ? size - 2 : size, pad = tile ? 1 : 0;
  return s('g', { class: `ci-g${tile ? ` ${TILE_CLASS[tile]}` : ''}`, 'aria-hidden': 'true' },
    tile ? s('rect', { class: 'ci-tile', x, y, width: outer, height: outer, rx: 3, style: 'fill:var(--ci-f);stroke:var(--ci-s);stroke-width:1' }) : null,
    s('image', { class: 'ci-image', href: src, x: x + pad, y: y + pad, width: inner, height: inner, preserveAspectRatio: 'xMidYMid meet' }));
}
