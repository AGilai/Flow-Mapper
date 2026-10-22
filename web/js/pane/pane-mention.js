// The "@" picker of the About editor (0.33.0, frame 18 style): typing "@" after a space (or at the start) in the textarea opens the same list the comment editor has
// (rows of `.u-pick`), under the caret; the text after it narrows it; Up / Down choose, Enter or Tab insert the token `@[userId]` and a space, Esc closes and
// leaves the typed text. "+ New user" makes a user from the typed text. A token in an About renders as a chip in the pane (users/chips.js `renderChips`).

import { h } from '../dom.js';
import { api } from '../api.js';
import { filterUsers, nameKey, pickable } from '../../core/users-match.js';
import { userAvatar } from '../users/avatar.js';
import { me, remember, users, loadUsers } from '../users/directory.js';

const TRIGGER = /(^|\s)@([^\s@[\]{}]{0,40})$/;
const COPY = ['fontFamily', 'fontSize', 'fontWeight', 'lineHeight', 'letterSpacing', 'padding', 'borderWidth', 'boxSizing', 'whiteSpace', 'wordWrap', 'overflowWrap', 'tabSize'];

/** Where the caret of a textarea is on the screen: { left, top, bottom } (a hidden mirror of the text up to the caret). */
export function caretRect(ta, index = ta.selectionStart) {
  const cs = getComputedStyle(ta), mirror = h('div', { style: { position: 'absolute', visibility: 'hidden', top: 0, left: '-9999px', width: `${ta.clientWidth}px`, whiteSpace: 'pre-wrap' } });
  for (const k of COPY) mirror.style[k] = cs[k];
  const mark = h('span', '​');
  mirror.append(document.createTextNode(ta.value.slice(0, index)), mark);
  document.body.append(mirror);
  const r = ta.getBoundingClientRect(), lh = parseFloat(cs.lineHeight) || 18, left = r.left + mark.offsetLeft - ta.scrollLeft, top = r.top + mark.offsetTop - ta.scrollTop;
  mirror.remove();
  return { left, top, bottom: top + lh };
}

export function attachMentionPicker(ta) {
  let pop = null, at = null, items = [], idx = 0, busy = false;
  const close = () => { pop?.remove(); pop = null; at = null; };

  function detect() {
    const before = ta.value.slice(0, ta.selectionStart), m = TRIGGER.exec(before);
    if (!m || ta.selectionStart !== ta.selectionEnd) return close();
    at = { start: ta.selectionStart - m[2].length - 1, caret: ta.selectionStart, q: m[2] };
    draw();
  }
  function draw() {
    const all = users(), found = filterUsers(pickable(all), at.q).slice(0, 8), canNew = !!nameKey(at.q) && !all.some((u) => nameKey(u.name) === nameKey(at.q));
    items = [...found, ...(canNew ? [{ fresh: at.q }] : [])];
    if (!items.length) return close();
    idx = Math.max(0, Math.min(idx, items.length - 1));
    const rows = items.map((u, i) => h('div.u-pk', { role: 'option', 'aria-selected': String(i === idx), class: `${i === idx ? 'on' : ''} ${u.fresh ? 'new' : ''}`.trim(), 'data-qa': u.fresh ? 'mention-new' : 'mention-opt', on: { mousedown: (e) => { e.preventDefault(); choose(i); } } },
      u.fresh ? [h('span.plus', '+'), h('span', `New user “${u.fresh}”`), h('small')] : [userAvatar(u, 's'), h('b', u.name), h('small', me()?.id === u.id ? 'you' : u.externalIds?.[0]?.source ?? '')]));
    const box = h('div.u-pick', { role: 'listbox', 'aria-label': 'Mention someone' }, rows, h('div.u-keys', h('kbd', '↑'), ' ', h('kbd', '↓'), ' choose · ', h('kbd', 'Enter'), ' insert · ', h('kbd', 'Esc'), ' close'));
    pop ? pop.replaceWith(box) : document.body.append(box);
    pop = box;
    const b = caretRect(ta, at.start), w = Math.min(300, innerWidth - 16), below = innerHeight - b.bottom - 12, up = pop.offsetHeight > below && b.top - 12 > below;
    Object.assign(pop.style, { width: `${w}px`, left: `${Math.max(8, Math.min(b.left, innerWidth - w - 8))}px`, top: up ? 'auto' : `${b.bottom + 4}px`, bottom: up ? `${innerHeight - b.top + 4}px` : 'auto', overflowY: 'auto', maxHeight: `${Math.max(120, up ? b.top - 12 : below)}px` });
  }
  async function choose(i) {
    const it = items[i];
    if (!it || busy || !at) return;
    const { start, caret } = at;
    let user = it;
    if (it.fresh) { busy = true; try { user = await api.createUser({ name: it.fresh, match: true }); remember(user); } catch { busy = false; return; } busy = false; }
    close();
    const token = `@[${user.id}] `;
    ta.value = ta.value.slice(0, start) + token + ta.value.slice(caret);
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(start + token.length, start + token.length);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }
  ta.addEventListener('keydown', (e) => {
    if (!pop) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); idx = (idx + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length; draw(); }
    else if ((e.key === 'Enter' && !e.ctrlKey && !e.metaKey) || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); choose(idx); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  }, true);
  ta.addEventListener('input', () => { idx = 0; detect(); });
  ta.addEventListener('blur', () => setTimeout(() => { if (document.activeElement !== ta) close(); }, 120)); // the toolbar's @ button blurs and refocuses at once: keep its picker
  loadUsers().catch(() => {});
  return {
    /** The toolbar's "@" button: type an "@" (after a space when the caret follows a word) and let the picker open. */
    open() {
      const p = ta.selectionStart, prev = ta.value.slice(Math.max(0, p - 1), p), ins = prev && !/\s/.test(prev) ? ' @' : '@';
      ta.setRangeText(ins, p, ta.selectionEnd, 'end');
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    },
    close, dispose: close,
  };
}
