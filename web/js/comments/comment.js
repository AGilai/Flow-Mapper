// One comment (0.27.0, frame 13): avatar with initials, name, a "you" tag, relative time (the full date in the tooltip), "edited", the step pill,
// and Reply / Edit / Delete (Edit and Delete only for the author: the name remembered in this browser). The body is set as HTML only after
// the core sanitizer has run over it again (the server sanitized it too: defence in depth). Delete asks first, in the line itself.

import { h } from '../dom.js';
import { sanitize } from '../../core/rich-text.js';
import { avatar, createComposer } from './composer.js';
import { relTime, fullDate as full } from './pure.js';

/** The body element: sanitized HTML, set once. */
export const bodyEl = (html) => h('div.cm-body', { html: sanitize(html) });

/**
 * commentItem(node, x) -> { el, dispose }
 * x: { me() -> name, step(key) -> { n } | null, jump(n), top: boolean (a reply has no Reply), api: { edit(id, html), remove(id), reply(id) } }
 */
export function commentItem(node, x) {
  const parts = [];
  const mine = !node.deleted && !!x.me() && node.author === x.me();
  const head = h('div.cm-head');
  const body = h('div.cm-slot');
  const el = h('div.cm', { 'data-id': node.id, class: node.deleted ? 'deleted' : '' }, node.deleted ? h('div.av.gone', { 'aria-hidden': 'true' }) : avatar(node.author), h('div', head, body));
  const time = h('span.tm', { title: full(node.createdAt) }, relTime(node.createdAt));

  function pill() {
    if (!node.step) return null;
    const s = x.step(node.step);
    return s ? h('button.spill', { type: 'button', title: `Go to step ${s.n} in the walk`, 'data-qa': 'cm-step', on: { click: () => x.jump(s.n) } }, `step ${s.n}`) : h('span.spill.gone', { title: 'The flow has changed: that step is no longer in it' }, 'step (gone)');
  }
  function show() { // the head and the body as they read
    const act = h('span.cm-act', { role: 'group', 'aria-label': 'Comment actions' });
    const link = (t, fn, cls = '', qa) => h('button.lnk', { type: 'button', class: cls, 'data-qa': qa, on: { click: fn } }, t);
    if (!node.deleted) {
      if (x.top) act.append(link('Reply', () => x.api.reply(node.id), '', 'cm-reply'));
      if (mine) act.append(link('Edit', edit, '', 'cm-edit'), link('Delete', ask, 'd', 'cm-del'));
    }
    head.replaceChildren(...(node.deleted ? [h('span.cm-gone', 'Comment deleted'), time]
      : [h('b', node.author), mine ? h('span.you', 'you') : null, time, node.editedAt ? h('span.ed', { title: `Edited ${full(node.editedAt)}` }, 'edited') : null, pill(), act]).filter(Boolean));
    body.replaceChildren(...(node.deleted ? [] : [bodyEl(node.body)]));
  }
  function edit() {
    const c = createComposer({ mode: 'edit', html: node.body, onSubmit: async ({ html }) => { await x.api.edit(node.id, html); }, onCancel: () => { c.dispose(); el.classList.remove('cm-editing'); show(); } });
    parts.push(c);
    el.classList.add('cm-editing');
    head.querySelector('.cm-act')?.remove(); // while it is edited the actions are in the editor
    body.replaceChildren(c.el); c.focus();
  }
  function ask() {
    const act = head.querySelector('.cm-act');
    const busy = { v: false };
    act.replaceChildren(h('span.cm-ask', { role: 'alert' }, 'Delete this comment?'),
      h('button.lnk.d', { type: 'button', 'data-qa': 'cm-del-yes', on: { click: async (e) => { if (busy.v) return; busy.v = true; e.target.disabled = true; try { await x.api.remove(node.id); } catch (er) { busy.v = false; act.replaceChildren(h('span.cm-err', er.message)); } } } }, 'Delete'),
      h('button.lnk', { type: 'button', 'data-qa': 'cm-del-no', on: { click: show } }, 'Cancel'));
    act.querySelector('button.lnk.d').focus();
  }
  show();
  return { el, dispose: () => parts.forEach((p) => p.dispose()), restep: show };
}
