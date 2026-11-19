// CR #148: a lifeline head with its own component icon (`details.icon`) draws the logo large, centred at the top, the name under it and the product (`details.product`)
// in grey under that; the other sub lines follow, centred. Only 'own' icons: a store, channel, lambda or gateway head keeps the small icon left of its name.
// Pure measures here, shared by the layout (box height, name width) and the drawing (flow-draw-heads.js, flow-draw-icons.js).

import { headIconOf } from './flow-draw-icons.js';
import { productFor } from '../design/service-info.js';

export const LG_ICON = 30, LG_TOP = 8, LG_SHIFT = 34, PRODUCT_H = 13; // the logo's box and top, how far the first text line drops, a product line's height

/** Does this head get the large layout? */
export const isLarge = (c) => headIconOf(c)?.[0] === 'own';

/** The grey product line of a large head (`details.product`, one line, cut at 40 characters), or null. */
export const productOf = (c) => { const p = isLarge(c) ? productFor(c.service, c.env ?? '') : null; return p ? (p.length > 40 ? `${p.slice(0, 39)}…` : p) : null; };

/** The logo size for a head box `w` px wide: 30, scaled down in a narrow head (never under 16). */
export const iconSize = (w) => Math.max(16, Math.min(LG_ICON, w - 28));

/** The characters a large head's name may use per line: the full width, the logo is above it. */
export const nameChLarge = (w) => Math.max(9, Math.floor((w - 20) / 6.6));

/** The px a large head adds to the box height above today's text block (the logo, and the product line when there is one); 0 for any other head. */
export const largeExtra = (c) => (isLarge(c) ? LG_SHIFT + (productOf(c) ? PRODUCT_H : 0) : 0);

/** The product line cut to what fits a head box `w` px wide (11px text, about 5.8 px a character). */
export const clipProduct = (p, w) => { const n = Math.max(8, Math.floor((w - 14) / 5.8)); return p && p.length > n ? `${p.slice(0, n - 1)}…` : p; };
