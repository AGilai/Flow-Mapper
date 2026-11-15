// The "/" insert menu of the document editor (Unreleased, frame 28d): type "/" at the start of an empty line, a list of blocks opens under the caret and
// narrows as you type ("/cal" finds the callouts); arrows move, Enter or a click inserts, Esc or a space with no match closes it. The typed "/word" is
// removed first, so the block replaces it. Items are the commands of insert.js.

import { h } from '../dom.js';

const norm = (s) => s.toLowerCase();

/** attachSlash(ed, items: [{ id, label, hint, run() }]) -> { dispose() } */
export function attachSlash(ed, items) {
  let menu = null, at = null, shown = [], sel = 0; // at: { node, start, end } the "/word" in its text node
  const close = () => { menu?.remove(); menu = null; at = null; };

  /** The "/word" at the caret when it is alone on its line, else null. */
  function typed() {
    const s = getSelection(), r = s?.rangeCount ? s.getRangeAt(0) : null;
    if (!r || !r.collapsed || r.startContainer.nodeType !== 3 || !ed.inside(r.startContainer)) return null;
    const n = r.startContainer, t = n.data.slice(0, r.startOffset), m = /^\/([a-z0-9 ]{0,16})$/i.exec(t);
    const line = n.parentElement?.closest('p, li, h1, h2, h3, div, td, th') ?? ed.el;
    return m && line.textContent.trim() === t.trim() ? { node: n, q: m[1], end: r.startOffset, rect: r.getBoundingClientRect() } : null;
  }
  function draw(t) {
    const q = norm(t.q.trim());
    shown = items.filter((i) => !q || norm(`${i.label} ${i.id}`).includes(q));
    if (!shown.length) { close(); return; }
    sel = Math.min(sel, shown.length - 1);
    const wrap = ed.el.parentElement;
    if (!menu) { menu = h('div.omenu.nt-slash', { role: 'listbox', 'aria-label': 'Insert a block', 'data-qa': 'slash-menu' }); wrap.append(menu); }
    menu.replaceChildren(...shown.map((i, k) => h('button.om', { type: 'button', role: 'option', 'aria-selected': String(k === sel), class: k === sel ? 'on' : '', 'data-id': i.id, on: { mousedown: (e) => { e.preventDefault(); pick(i); } } }, h('b', i.label), i.hint ? h('small', i.hint) : null)));
    const r = t.rect, mh = menu.offsetHeight, below = r.bottom + 4 + mh <= innerHeight || r.top - 4 - mh < 0; // under the caret, or over it when there is no room
    menu.style.top = `${Math.max(4, below ? r.bottom + 4 : r.top - 4 - mh)}px`; menu.style.left = `${Math.max(4, Math.min(r.left, innerWidth - 330))}px`;
    menu.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    at = { node: t.node, end: t.end };
  }
  function pick(item) {
    const a = at; close();
    if (!a || !a.node.isConnected) return;
    a.node.deleteData(0, a.end); // the "/word" goes; an empty paragraph is left for the block to replace
    const blk = a.node.parentElement; if (blk && !blk.querySelector('br') && !blk.textContent) blk.append(document.createElement('br'));
    const r = document.createRange(); r.setStart(a.node, 0); r.collapse(true);
    const s = getSelection(); s.removeAllRanges(); s.addRange(r);
    item.run();
  }
  const onInput = () => { const t = typed(); if (t) draw(t); else close(); };
  const onKey = (e) => {
    if (!menu) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); e.stopImmediatePropagation(); sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; const t = typed(); if (t) draw(t); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopImmediatePropagation(); pick(shown[sel]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(); }
  };
  ed.el.addEventListener('input', onInput); ed.el.addEventListener('keydown', onKey, true); ed.el.addEventListener('blur', () => setTimeout(close, 120));
  return { dispose: () => { ed.el.removeEventListener('input', onInput); ed.el.removeEventListener('keydown', onKey, true); close(); } };
}
