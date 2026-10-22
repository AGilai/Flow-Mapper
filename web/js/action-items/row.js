// One action item as a read row (0.29.0, frame 15c): number, owner, description (with "from X's comment" and the step pill), due date (overdue in the
// warning colour), status chip, and Edit / Delete (Delete only for the creator: the name remembered in this browser). Edit and Delete show on hover
// and focus, and always on touch and at 760 px. Delete asks first, in the row itself.

import { h } from '../dom.js';
import { isOpen } from '../../core/action-items.js';
import { STATUS, CHIP, isLate, fmtDue } from './pure.js';
import { userAvatar } from '../users/avatar.js';
import { isMe } from '../users/directory.js';
import { hiddenPill } from '../views/flow-hidden-pill.js';

/**
 * actionRow(item, x) -> { el }
 * x: { today, commentOf(id) -> node | null, stepOf(key) -> { n } | null, jump(n), toComment(id), edit(item), remove(item) -> Promise }
 */
export function actionRow(item, x) {
  const closed = !isOpen(item.status), late = isLate(item, x.today);
  const mine = isMe(item.createdById, item.createdBy);
  const act = h('span.ai-act', { role: 'group', 'aria-label': `Actions for #${item.number}` });
  const el = h('div.ai-r', { 'data-qa': 'ai-row', 'data-number': item.number, class: closed ? 'closed' : '' });

  function origin() {
    if (item.commentId == null) return null;
    const c = x.commentOf(item.commentId);
    if (!c || c.deleted) return h('span.bl.gone-src', ' · from a deleted comment'); // the comment is gone: plain text, the item stays
    return h('span.bl', ' · ', h('button.lnk', { type: 'button', title: 'Show that comment', 'data-qa': 'ai-src', on: { click: () => x.toComment(item.commentId) } }, `from ${c.author}’s comment`));
  }
  function stepPill() {
    if (!item.step) return null;
    const s = x.stepOf(item.step);
    const hid = s ? null : x.hidden?.(item.step);
    return s ? h('button.spill', { type: 'button', title: `Go to step ${s.n} in the walk`, 'data-qa': 'ai-step', on: { click: () => x.jump(s.n) } }, `step ${s.n}`) : hid ? hiddenPill(hid) : h('span.spill.gone', { title: 'The flow has changed: that step is no longer in it' }, 'step (gone)');
  }
  function show() {
    act.replaceChildren(...[h('button.lnk', { type: 'button', 'data-qa': 'ai-edit', 'aria-label': `Edit #${item.number}`, on: { click: () => x.edit(item) } }, 'Edit'),
      mine ? h('button.lnk.d', { type: 'button', 'data-qa': 'ai-del', 'aria-label': `Delete #${item.number}`, on: { click: ask } }, 'Delete') : null].filter(Boolean));
    act.classList.remove('asking');
  }
  function ask() {
    act.classList.add('asking');
    let busy = false;
    act.replaceChildren(h('span.cm-ask', { role: 'alert' }, `Delete action #${item.number}? Numbers are not reused.`),
      h('button.lnk.d', { type: 'button', 'data-qa': 'ai-del-yes', on: { click: async (e) => { if (busy) return; busy = true; e.target.disabled = true; try { await x.remove(item); } catch (er) { busy = false; act.replaceChildren(h('span.cm-err', er.message)); } } } }, 'Delete'),
      h('button.lnk', { type: 'button', 'data-qa': 'ai-del-no', on: { click: show } }, 'Cancel'));
    act.querySelector('button.lnk.d').focus();
  }
  show();

  const ai = item.source === 'ai' ? h('span.ai-by', { title: 'Written by an AI agent' }, 'by AI') : null;
  const extra = [stepPill(), ai].filter(Boolean);
  el.append(
    h('span.ai-n', `#${item.number}`),
    h('span.ai-o', { title: item.owner }, userAvatar({ name: item.owner, id: item.ownerId }, 's'), h('span.ai-on', item.owner)),
    h('span.ai-d', item.description, origin(), extra.length ? h('small', extra) : null),
    h('span.ai-due', { class: late ? 'late' : '' }, item.due ? (late ? `${fmtDue(item.due, x.today)} · overdue` : fmtDue(item.due, x.today)) : h('span.muted', '—')),
    h('span', h('span.ai-st', { class: CHIP[item.status] }, STATUS[item.status] ?? item.status)),
    act,
  );
  return { el };
}
