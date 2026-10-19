// Paths to each object's detail page, shared by the inventory and the detail views.

import { h } from '../dom.js';
import { href } from '../router.js';

const enc = encodeURIComponent;

export const servicePath = (name) => `/services/${enc(name)}`;
export const storePath = (key) => `/stores/${enc(key)}`;
export const channelPath = (key) => `/channels/${enc(key)}`;
export const eventPath = (type) => `/events/${enc(type)}`;

/** Detail path for an inventory item {type, id}. */
export const detailPath = (x) => ({ service: servicePath, store: storePath, channel: channelPath, event: eventPath })[x.type](x.id);

export const serviceLink = (name, label = name) => h('a', { href: href(servicePath(name)) }, label);
export const storeLink = (key, label = key) => h('a.key', { href: href(storePath(key)) }, label);
export const channelLink = (key, label = key) => h('a.key', { href: href(channelPath(key)) }, label);
export const eventLink = (type) => h('a.key', { href: href(eventPath(type)) }, type);
