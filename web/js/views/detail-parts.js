// Small building blocks shared by the store, channel and event pages.

import { h } from '../dom.js';
import { icon } from '../icons.js';

export const fig = (n, label, bad = false) => h('div.figure', { class: bad ? 'bad' : '' }, h('b', String(n ?? 0)), h('span', label));

/** A titled box; `count` is shown next to the title. */
export const box = (title, count, ...content) =>
  h('section.box', h('div.box-head', h('h2', title, count != null ? h('span.muted.small', ` ${count}`) : null)), h('div.box-body', ...content));

export const problems = (list) => (list.length
  ? h('div.problems', list.map((p) => h('div.problem', icon('health'), h('span', p))))
  : null);

/** Link to a line of code (SourceLink from core), or plain text when there is no URL. */
export const codeLink = (label, source) => (source?.url
  ? h('a.code-link', { href: source.url, target: '_blank', rel: 'noopener noreferrer', title: source.url }, h('span', label), icon('external'))
  : h('span', label));

export const empty = (text) => h('p.small.muted', text);
