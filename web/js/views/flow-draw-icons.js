// Product icons on the flow diagram (0.27.3): the same files as the map and the inventory (object-icon.js `iconFile`, one source of truth).
// A store head, a channel head, a lambda or gateway head and a store band show the logo of what they are; an unknown kind keeps today's line glyph.

import { s } from '../dom.js';
import { iconFile } from '../components/object-icon.js';
import { kindFor } from '../design/service-info.js';

const CH_KIND = { sns: 'sns-topic', sqs: 'sqs-queue', eventbridge: 'eventbridge-bus', amqp: 'amqp-queue' }; // a channel lifeline knows its transport (flow-chain.js chType)
export const TEXT_X = 32; // x of a head's text when the head has an icon before it (14px icon at x 12)

/** The [type, kind] of the icon a lifeline head shows, or null. A service shows one only when it is a lambda or a gateway. */
export function headIconOf(c) {
  const [type, kind] = c.kind === 'resource' ? ['store', c.storeKind] : c.kind === 'channel' ? ['channel', CH_KIND[c.transport] ?? c.transport] : c.kind === 'service' ? ['service', c.serviceKind ?? kindFor(c.service, c.env)] : [];
  return type && iconFile(type, kind) ? [type, kind] : null;
}

/** The product icon as SVG <image> at x y, `size` px, or null when the kind has no icon. */
export const productImage = (type, kind, x, y, size = 14) => {
  const f = iconFile(type, kind);
  return f ? s('image', { class: 'pimg', href: `icons/${f}.svg`, x, y, width: size, height: size, 'aria-hidden': 'true' }) : null;
};

/** The icon of a lifeline head; a folded store stack gets a faded copy behind. null: the caller draws its own glyph. */
export function headIcon(c) {
  const k = headIconOf(c);
  if (!k) return null;
  return [c.stack ? s('g', { opacity: 0.45 }, productImage(k[0], k[1], 16, 14)) : null, productImage(k[0], k[1], 12, 10)];
}
