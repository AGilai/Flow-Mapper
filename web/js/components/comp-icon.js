// A component's type icon (frame 34, 0.68.0): the logo of its resolved type (web/js/components/type-info.js), drawn left of a name or large on a lifeline head.
// A specific type is the product's official mark, never recoloured; a plain tile sits behind it only where frame 32 says (Vault slate, Kafka and MySQL white in dark mode only).
// A generic type is an AWS General icon in two files (Light = dark ink, Dark = white ink) that swap with the theme (CSS: .ci-lt / .ci-dk). Every icon is an <img> / <image> with a URL.
// The picture is decorative: empty alt, the name is the label.
//   compIcon(typeId, size) -> HTML node (lists, the Info pane, the picker)    compIconSvg(typeId, x, y, size) -> <g> for the sequence diagram

import { h, s } from '../dom.js';
import { typeInfo, typeSrc, typeTile, isGeneric } from './type-info.js';

const TILE_CLASS = { slate: 'ci-slate', 'white-dark': 'ci-wd' };

/** A tile adds 2px around the mark: the outer box is `size + 2`, the mark `size - 2`. Without a tile the mark is `size`. */
export function compIcon(id, size = 14) {
  if (!typeInfo(id)) return null;
  const tile = typeTile(id), outer = tile ? size + 2 : size, inner = tile ? size - 2 : size;
  const img = (dark) => h(`img.ci-img${isGeneric(id) ? (dark ? '.ci-dk' : '.ci-lt') : ''}`, { src: typeSrc(id, dark), alt: '', width: inner, height: inner, draggable: false, decoding: 'async' });
  return h(`span.ci${tile ? `.${TILE_CLASS[tile]}` : ''}`, { 'aria-hidden': 'true', style: { width: `${outer}px`, height: `${outer}px` } }, isGeneric(id) ? [img(false), img(true)] : img(false));
}

/** The icon for an SVG drawing, its box top-left at (x, y); a tile is a rect the stylesheet paints (so dark mode needs no redraw). */
export function compIconSvg(id, x, y, size = 14) {
  if (!typeInfo(id)) return null;
  const tile = typeTile(id), outer = tile ? size + 2 : size, inner = tile ? size - 2 : size, pad = tile ? 1 : 0;
  const image = (dark) => s('image', { class: `ci-image${isGeneric(id) ? (dark ? ' ci-dk' : ' ci-lt') : ''}`, href: typeSrc(id, dark), x: x + pad, y: y + pad, width: inner, height: inner, preserveAspectRatio: 'xMidYMid meet' });
  return s('g', { class: `ci-g${tile ? ` ${TILE_CLASS[tile]}` : ''}`, 'aria-hidden': 'true' },
    tile ? s('rect', { class: 'ci-tile', x, y, width: outer, height: outer, rx: 3, style: 'fill:var(--ci-f);stroke:var(--ci-s);stroke-width:1' }) : null,
    isGeneric(id) ? [image(false), image(true)] : image(false));
}
