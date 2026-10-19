// Standard page header used by every view.

import { h } from '../dom.js';

export function pageHead(title, sub, ...toolbar) {
  return h('header.page-head', h('div.grow', h('h1', title), sub ? h('p.sub', sub) : null), h('div.toolbar', ...toolbar));
}
