// Product icons on the flow diagram (0.27.3): the same files as the map and the inventory (object-icon.js `iconFile`, one source of truth).
// A store head, a channel head, a lambda or gateway head and a store band show the logo of what they are; an unknown kind keeps today's line glyph.

import { s } from '../dom.js';
import { iconFile } from '../components/object-icon.js';
import { kindFor, typeFor } from '../design/service-info.js';
import { compIconSvg } from '../components/comp-icon.js';
import { resolveType, storeTypeOf, channelTypeOf } from '../components/type-info.js';

const CH_KIND = { sns: 'sns-topic', sqs: 'sqs-queue', eventbridge: 'eventbridge-bus', amqp: 'amqp-queue' }; // a channel lifeline knows its transport (flow-chain.js chType)
export const TEXT_X = 32; // x of a head's text when the head has a small icon before it (14px icon at x 12)

/** The type a lifeline head draws, as ['own', typeId], or null. Frame 34: a service head's resolved type (declared, legacy details.icon, kind), a store's driver, a channel's transport; plain `service` has none. */
export function headIconOf(c) {
  let id = null;
  if (c.kind === 'resource') id = storeTypeOf(c.storeKind);
  else if (c.kind === 'channel' || (c.kind === 'source' && c.transport)) id = channelTypeOf(CH_KIND[c.transport] ?? c.transport);
  else if (c.kind === 'service') { const t = typeFor(c.service, c.env ?? '') ?? resolveType({ kind: c.serviceKind ?? kindFor(c.service, c.env) }); id = t.id === 'service' ? null : t.id; }
  return id ? ['own', id] : null;
}

/** The product icon as SVG <image> at x y, `size` px, or null when the kind has no icon. */
export const productImage = (type, kind, x, y, size = 14) => {
  const f = iconFile(type, kind);
  return f ? s('image', { class: 'pimg', href: `icons/${f}.svg`, x, y, width: size, height: size, 'aria-hidden': 'true' }) : null;
};

/** The icon of a lifeline head: large, centred at the top (flow-head-large.js); a folded store stack gets a faded copy behind. null: the caller draws its own glyph. */
export function headIcon(c, w = 130) {
  const k = headIconOf(c);
  if (!k) return null;
  const z = Math.max(16, Math.min(30, w - 28)), x = (w - z) / 2;
  return [c.stack ? s('g', { opacity: 0.45 }, compIconSvg(k[1], x + 5, 11, z)) : null, compIconSvg(k[1], x, 8, z)];
}
