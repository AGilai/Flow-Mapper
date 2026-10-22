// The rich-text editor of a comment (0.27.0): a contenteditable area with the selection kept for the toolbar, our own paste and drop,
// and one way out for the HTML: core/rich-text.js sanitize(). Commands that the browser does well use execCommand (bold, italic, strike,
// lists, link); colour and tables are our own (rte-colour.js, rte-table.js). Chromium is the browser that is checked.

import { h } from '../dom.js';
import { sanitize, esc } from '../../core/rich-text.js';
import { plainText } from '../../core/rich-text-text.js';
import { cellOf, onTab } from './rte-table.js';
import { textToHtml as plain } from './pure.js';
import { attachMention } from './rte-mention.js';
import { renderChips, chipsToTokens, refreshChips } from '../users/chips.js';
import { watchUsers } from '../users/directory.js';

const ZW = /​/g;
const textToHtml = (t) => plain(t, esc);

/**
 * createEditor({ html, label, placeholder, onSubmit, onEscape, onChange, people }) ->
 *   { el, focus(end), getHtml(), setHtml(html), isEmpty(), exec(fn), inside(node), range(), mention, dispose() }
 * 0.31.0: `@[id]` tokens are drawn as chips (not editable text) and written back as tokens; `people()` lists the user ids already in the thread (the "@" picker shows them first).
 * getHtml() is sanitized and trimmed ('' when there is no text); setHtml() sanitizes first. onChange fires on input and on a move of the caret.
 */
export function createEditor({ html = '', label = 'Comment', placeholder = '', onSubmit, onEscape, onChange, people } = {}) {
  const el = h('div.rte-area', { contentEditable: 'true', role: 'textbox', 'aria-multiline': 'true', 'aria-label': label, spellcheck: true, 'data-ph': placeholder, 'data-qa': 'rte' });
  let saved = null;
  const inside = (n) => !!n && el.contains(n);
  const range = () => { const s = getSelection(); return s && s.rangeCount && inside(s.anchorNode) ? s.getRangeAt(0) : null; };
  const isEmpty = () => !plainText(el.innerHTML) && !el.querySelector('table');
  const note = () => { el.classList.toggle('is-empty', isEmpty()); onChange?.(); };
  const keep = () => { const r = range(); if (r) { saved = r.cloneRange(); onChange?.(); } };
  document.addEventListener('selectionchange', keep);

  function exec(fn) { // run a command on the saved selection, the editor focused
    el.focus({ preventScroll: true });
    // the saved selection comes back only when the editor lost focus; while it has focus the live selection (and a pending format) stays
    if (saved && !(document.activeElement === el && range())) { const s = getSelection(); s.removeAllRanges(); s.addRange(saved); }
    fn(range());
    keep(); note();
  }
  function insertHtml(clean) { exec(() => { if (clean) document.execCommand('insertHTML', false, clean); }); }
  function setHtml(v) { el.innerHTML = sanitize(v || ''); renderChips(el, { editable: true }); saved = null; note(); }
  function getHtml() {
    const c = chipsToTokens(el.cloneNode(true));
    c.querySelectorAll('span').forEach((s) => { if (!s.textContent.replace(ZW, '') && !s.querySelector('br')) s.remove(); }); // a colour chosen and not used
    const out = sanitize(c.innerHTML.replace(ZW, '')).replace(/(?:<p><br><\/p>)+$/, '');
    return plainText(out) || /<table/.test(out) ? out : '';
  }

  el.addEventListener('input', note);
  el.addEventListener('paste', (e) => { // only what the sanitizer lets through: formatting from Word, Confluence or a page comes across, fonts and colours do not
    e.preventDefault();
    const cd = e.clipboardData, text = cd?.getData('text/plain') ?? '';
    insertHtml((cd?.getData('text/html') ? sanitize(cd.getData('text/html')) : '') || textToHtml(text));
  });
  el.addEventListener('drop', (e) => { e.preventDefault(); const t = e.dataTransfer?.getData('text/plain'); if (t) insertHtml(textToHtml(t)); });
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); onSubmit?.(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onEscape?.(); return; }
    if (e.key === 'Tab' && cellOf(el, range()?.startContainer)) onTab(el, e, range());
  });
  try { document.execCommand('defaultParagraphSeparator', false, 'p'); document.execCommand('styleWithCSS', false, false); } catch { /* the browser decides */ }
  if (html) setHtml(html); else note();
  const off = watchUsers(() => refreshChips(el));
  const api = {
    el, inside, range, exec, isEmpty, getHtml, setHtml,
    focus(end = true) { el.focus({ preventScroll: false }); if (end) { const r = document.createRange(); r.selectNodeContents(el); r.collapse(false); const s = getSelection(); s.removeAllRanges(); s.addRange(r); keep(); } },
    dispose: () => { document.removeEventListener('selectionchange', keep); off(); api.mention.dispose(); },
  };
  api.mention = attachMention(api, { people });
  return api;
}
