// Frame 34 (CR #148, 0.68.0): a lifeline head whose resolved type is not plain `service` (a component's `type`, a store's driver, a channel's transport) draws the logo large, centred at the top,
// with the name under it and nothing else (the type is in the info pane and the hover card); the lane's head width is auto (autoCol). An untyped head keeps name + "service".
// Pure measures here, shared by the layout (box height, name width) and the drawing (flow-draw-heads.js, flow-draw-icons.js).

import { headIconOf } from './flow-draw-icons.js';

export const LG_ICON = 30, LG_TOP = 8, LG_SHIFT = 34, COL_AUTO_MAX = 238; // COL_AUTO_MAX: the widest lane column (a head box is 8 px less: 230); a longer name wraps
const CH_W = 6.6; // the logo's box and top, how far the first text line drops

/** Does this head get the large layout? */
export const isLarge = (c) => headIconOf(c)?.[0] === 'own';

/** The logo size for a head box `w` px wide: 30, scaled down in a narrow head (never under 16). */
export const iconSize = (w) => Math.max(16, Math.min(LG_ICON, w - 28));

/** The characters a large head's name may use per line: the full width, the logo is above it. */
export const nameChLarge = (w) => Math.max(9, Math.floor((w - 20) / 6.6));

/** The px a large head adds to the box height above today's text block (the logo); 0 for any other head. Its type line is not drawn (the info pane has it). */
export const largeExtra = (c) => (isLarge(c) ? LG_SHIFT : 0);

/** The px of a head box one line of `n` name characters needs, `slots` px of icon / padding included. */
const need = (c, storeOn) => { const n = (c.sub === 'queue delivery' ? c.label.replace(/^[^:]+:/, '') : c.label).length;
  return Math.ceil(n * CH_W) + (isLarge(c) ? 20 : c.kind === 'resource' || headIconOf(c) ? 34 : 14) + (storeOn && c.kind === 'resource' && (c.storeKind === 'redis' || c.storeKind === 'mongodb') ? 24 : 0); };

/** The lane's auto column width: the width the longest head name needs on one line, never under `min` (today's width), never over COL_AUTO_MAX (a longer name wraps). Channels and stacks have their own widths and do not count. */
export const autoCol = (columns, { min = 138, storeOn = false } = {}) => Math.min(COL_AUTO_MAX, Math.max(min, ...columns.filter((c) => c.kind !== 'channel' && !c.stack).map((c) => need(c, storeOn) + 8)));
