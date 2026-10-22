// Paths to each object's detail page, shared by the inventory and the detail views.

import { h } from '../dom.js';
import { href } from '../router.js';
import { state } from '../state.js';

const enc = encodeURIComponent;

export const servicePath = (name) => `/services/${enc(name)}`;
export const storePath = (key) => `/stores/${enc(key)}`;
export const instancePath = (key) => `/instances/${enc(key)}`;
export const channelPath = (key) => `/channels/${enc(key)}`;
export const eventPath = (type) => `/events/${enc(type)}`;

/** Detail path for an inventory item {type, id}. */
export const detailPath = (x) => (x.type === 'store' && x.instance || x.kind === 'amqp-exchange' ? instancePath : { service: servicePath, store: storePath, channel: channelPath, event: eventPath }[x.type])(x.id);

/** Where a row opens: [path, query]. An RPC command opens its server's page with the endpoint panel (`ep`), a reply-queue row the caller's page. */
export const openTarget = (x) => (x.open ? [servicePath(x.open.service), x.open.ingress ? { ep: x.open.ingress } : undefined] : [detailPath(x)]);

/** The query that opens a page in `env` when that is not the page's own environment (a tab of another env links to its own pages, 0.36.0). */
export const envQuery = (env, q) => (env && env !== state.env ? { ...q, env } : q);
export const serviceLink = (name, label = name, env = null) => h('a', { href: href(servicePath(name), envQuery(env)) }, label);
export const storeLink = (key, label = key, env = null) => h('a.key', { href: href(storePath(key), envQuery(env)) }, label);
export const channelLink = (key, label = key, env = null) => h('a.key', { href: href(channelPath(key), envQuery(env)) }, label);
export const eventLink = (type, env = null) => h('a.key', { href: href(eventPath(type), envQuery(env)) }, type);
