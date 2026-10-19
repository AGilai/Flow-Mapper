// Icons for map objects: official AWS Architecture Icons for AWS services, real brand logos for
// Redis, MongoDB, Postgres and RabbitMQ (sources in web/icons/README.md). Anything else falls back
// to the app's own line icons.

import { h } from '../dom.js';
import { icon } from '../icons.js';

// `${type}:${kind}` (or just type) → file in web/icons/ without .svg
const FILES = {
  'service:gateway': 'aws-api-gateway', 'service:lambda': 'aws-lambda',
  'channel:sns-topic': 'aws-sns', 'channel:sqs-queue': 'aws-sqs', 'channel:eventbridge-bus': 'aws-eventbridge',
  'channel:amqp-exchange': 'rabbitmq', 'channel:amqp-queue': 'rabbitmq',
  'store:dynamodb': 'aws-dynamodb', 'store:s3': 'aws-s3', 'store:redis': 'redis', 'store:mongodb': 'mongodb', 'store:postgres': 'postgres',
  event: 'aws-event',
};
const FALLBACK = { service: 'services', channel: 'flow', store: 'database', event: 'flow' };

export const iconFile = (type, kind) => FILES[`${type}:${kind}`] ?? FILES[type] ?? null;

/** <img> with the object's icon, or the fallback line icon. type: service | channel | store | event. */
export function objectIcon(type, kind, size = 20) {
  const f = iconFile(type, kind);
  if (f) return h('img.obj-icon', { src: `icons/${f}.svg`, alt: '', width: size, height: size, draggable: false });
  const el = icon(FALLBACK[type] ?? 'services', 'obj-icon');
  el.setAttribute('width', size); el.setAttribute('height', size);
  return el;
}

/** Title with its icon, for page heads and panel heads. */
export const titled = (type, kind, text, size = 26) => h('span.titled', objectIcon(type, kind, size), h('span', text));

// Canvas: decoded images, loaded once; `onLoad` asks the map to redraw when one arrives.
const images = new Map();
export function iconImage(type, kind, onLoad) {
  const f = iconFile(type, kind);
  if (!f) return null;
  let img = images.get(f);
  if (!img) {
    img = new Image();
    img.src = `icons/${f}.svg`;
    images.set(f, img);
  }
  if (!img.complete) img.addEventListener('load', onLoad, { once: true });
  return img.complete && img.naturalWidth ? img : null;
}
