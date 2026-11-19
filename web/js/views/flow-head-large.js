// CR #148: a lifeline head with its own component icon (`details.icon`) draws the logo large, centred at the top, the name under it and the product (`details.product`)
// in grey under that. Follow-up: the product and type lines are dropped from the head (they live in the info pane), and the lane's head width is auto (autoCol). Only 'own' icons: a store, channel, lambda or gateway head keeps the small icon left of its name.
// Pure measures here, shared by the layout (box height, name width) and the drawing (flow-draw-heads.js, flow-draw-icons.js).

import { headIconOf } from './flow-draw-icons.js';
import { productFor, runtimeFor, kindFor } from '../design/service-info.js';

export const LG_ICON = 30, LG_TOP = 8, LG_SHIFT = 34, PRODUCT_H = 13, COL_AUTO_MAX = 238; // COL_AUTO_MAX: the widest lane column (a head box is 8 px less: 230); a longer name wraps
const CH_W = 6.6; // the logo's box and top, how far the first text line drops, a product line's height

/** Does this head get the large layout? */
export const isLarge = (c) => headIconOf(c)?.[0] === 'own';

/** The grey product line of a large head (`details.product`, one line, cut at 40 characters), or null. */
export const productOf = (c) => { const p = isLarge(c) ? productFor(c.service, c.env ?? '') : null; return p ? (p.length > 40 ? `${p.slice(0, 39)}…` : p) : null; };

/** The logo size for a head box `w` px wide: 30, scaled down in a narrow head (never under 16). */
export const iconSize = (w) => Math.max(16, Math.min(LG_ICON, w - 28));

/** The characters a large head's name may use per line: the full width, the logo is above it. */
export const nameChLarge = (w) => Math.max(9, Math.floor((w - 20) / 6.6));

/** Does the manifest or flow know a specific type of this component (a runtime like a Kubernetes pod, or a kind: gateway, lambda, client app, infra)? A plain service has none. */
export const hasType = (c) => !!(c.service && (runtimeFor(c.service, c.env ?? '') || [c.serviceKind, kindFor(c.service, c.env ?? '')].some((k) => k && k !== 'service')));

/** The type line of a large head: none when a specific type is known (the info pane's Type row shows it), else the head's own sub line ("service") stays. */
export const largeSub = (c) => !hasType(c);

/** The px a large head adds to the box height above today's text block (the logo); 0 for any other head. Its product and type lines are not drawn (the info pane has them). */
export const largeExtra = (c) => (isLarge(c) ? LG_SHIFT : 0);

/** The px of a head box one line of `n` name characters needs, `slots` px of icon / padding included. */
const need = (c, storeOn) => { const n = (c.sub === 'queue delivery' ? c.label.replace(/^[^:]+:/, '') : c.label).length;
  return Math.ceil(n * CH_W) + (isLarge(c) ? 20 : c.kind === 'resource' || headIconOf(c) ? 34 : 14) + (storeOn && c.kind === 'resource' && (c.storeKind === 'redis' || c.storeKind === 'mongodb') ? 24 : 0); };

/** The lane's auto column width: the width the longest head name needs on one line, never under `min` (today's width), never over COL_AUTO_MAX (a longer name wraps). Channels and stacks have their own widths and do not count. */
export const autoCol = (columns, { min = 138, storeOn = false } = {}) => Math.min(COL_AUTO_MAX, Math.max(min, ...columns.filter((c) => c.kind !== 'channel' && !c.stack).map((c) => need(c, storeOn) + 8)));
