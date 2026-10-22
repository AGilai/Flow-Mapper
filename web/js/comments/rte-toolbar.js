// The toolbar of the comment editor (0.27.0, frame 13): B I S, text colour (default + six palette colours), bulleted and numbered list,
// link, table (3x3), and a Table group (+ row, - row, + col, - col) while the caret is in a table. At 760 px and below Link and Table
// (and the Table group) move into a "..." menu. Buttons keep the editor's selection (mousedown does not take focus), arrow keys move along
// the bar, Esc closes a menu and gives focus back to its button.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { safeHref } from '../../core/rich-text.js';
import { COLOURS, applyColour, colourAt } from './rte-colour.js';
import { insertTable, cellOf, tableOps } from './rte-table.js';
import { addressOf } from './pure.js';

export function createToolbar(ed) {
  const el = h('div.rte-tb', { role: 'toolbar', 'aria-label': 'Text formatting', 'data-qa': 'rte-toolbar' });
  let menu = null; // { el, btn }
  const btn = (cls, label, content, on, extra = {}) => {
    const b = h(`button.tbb${cls}`, { type: 'button', title: label, 'aria-label': label, tabindex: -1, on: { mousedown: (e) => e.preventDefault(), click: on }, ...extra }, content);
    return b;
  };
  const cmd = (name) => () => { closeMenu(); ed.exec(() => document.execCommand(name)); update(); };

  const bold = btn('', 'Bold (Ctrl+B)', h('b', 'B'), cmd('bold'), { 'aria-pressed': 'false' });
  const italic = btn('', 'Italic (Ctrl+I)', h('i', { style: { fontWeight: 500 } }, 'I'), cmd('italic'), { 'aria-pressed': 'false' });
  const strike = btn('', 'Strikethrough', h('s', { style: { fontWeight: 500 } }, 'S'), cmd('strikeThrough'), { 'aria-pressed': 'false' });
  const bar = h('span.abar');
  const colour = btn('.col', 'Text colour', ['A', bar], () => toggleMenu(colour, colourMenu), { 'aria-haspopup': 'true', 'aria-expanded': 'false' });
  const ul = btn('', 'Bulleted list', icon('ul'), cmd('insertUnorderedList'), { 'aria-pressed': 'false' });
  const ol = btn('', 'Numbered list', icon('ol'), cmd('insertOrderedList'), { 'aria-pressed': 'false' });
  const mention = btn('.wide', 'Mention someone (@)', [icon('at'), h('span', 'Mention')], () => { closeMenu(); ed.mention.open(); });
  const link = btn('.tb-late', 'Link', icon('link'), () => toggleMenu(link, linkMenu), { 'aria-haspopup': 'true', 'aria-expanded': 'false' });
  const tbl = btn('.wide.tb-late', 'Insert a table, 3 by 3', [icon('table'), h('span', '3×3')], () => doTable());
  const doTable = () => { closeMenu(); ed.exec((r) => insertTable(ed.el, r)); update(); }; // inside a table the new one goes after it
  const op = (name) => () => { closeMenu(); ed.exec((r) => { const c = cellOf(ed.el, r?.startContainer); if (c) tableOps(c)[name](); }); update(); };
  const group = [['+ row', 'Add a row below', 'addRow', 'canAddRow'], ['− row', 'Delete this row', 'delRow', 'canDelRow'], ['+ col', 'Add a column after', 'addCol', 'canAddCol'], ['− col', 'Delete this column', 'delCol', 'canDelCol']]
    .map(([t, label, name, can]) => Object.assign(btn('.wide', label, t, op(name)), { can, op: name, text: t, label }));
  const tg = h('span.tbgroup.tb-late', { hidden: true, role: 'group', 'aria-label': 'Table' }, h('span.lb', 'Table'), group);
  const more = btn('.tb-more', 'More', icon('more'), () => toggleMenu(more, moreMenu), { 'aria-haspopup': 'true', 'aria-expanded': 'false' });
  const sep = (cls = '') => h(`span.tbsep${cls}`, { 'aria-hidden': 'true' });
  el.append(bold, italic, strike, colour, sep(), ul, ol, sep('.tb-late'), mention, link, tbl, tg, more);
  const buttons = () => [...el.querySelectorAll(':scope > button, :scope > .tbgroup > button')].filter((b) => b.offsetParent !== null);
  el.addEventListener('keydown', (e) => { // arrow keys move along the bar (roving focus)
    if (e.target.closest('.cmenu, .omenu') || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    const bs = buttons(), i = bs.indexOf(document.activeElement);
    if (i < 0) return;
    e.preventDefault();
    bs[e.key === 'Home' ? 0 : e.key === 'End' ? bs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + bs.length) % bs.length].focus();
  });
  bold.tabIndex = 0;

  // Menus: one at a time, under their button, closed by Esc, a click elsewhere or a choice.
  function closeMenu() { if (!menu) return false; menu.btn.setAttribute('aria-expanded', 'false'); menu.el.remove(); menu = null; return true; }
  function toggleMenu(b, make) {
    if (menu?.btn === b) { closeMenu(); return; }
    closeMenu();
    const m = make(); b.setAttribute('aria-expanded', 'true');
    m.style.top = `${el.offsetTop + el.offsetHeight + 2}px`;
    el.parentElement.append(m); menu = { el: m, btn: b };
    m.style.left = `${Math.max(0, Math.min(b.offsetLeft + el.offsetLeft, el.parentElement.clientWidth - m.offsetWidth - 4))}px`;
    m.querySelector('input, button')?.focus();
    m.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); b.focus(); } });
  }
  const onDown = (e) => { if (menu && !menu.el.contains(e.target) && !menu.btn.contains(e.target)) closeMenu(); };
  document.addEventListener('mousedown', onDown);

  function colourMenu() {
    const cur = colourAt(ed.el, ed.range()?.startContainer);
    const pick = (c) => () => { closeMenu(); ed.exec((r) => applyColour(ed.el, r, c.cls)); update(); };
    const sws = COLOURS.map((c) => h('button.sw', { type: 'button', class: c.cls ?? 'def', title: c.name, 'aria-label': `${c.name} text`, 'aria-pressed': String((c.cls ?? null) === cur), on: { mousedown: (e) => e.preventDefault(), click: pick(c) } }, 'A'));
    return h('div.cmenu', { role: 'group', 'aria-label': 'Text colour' }, h('h5', 'Text colour'), h('div.sws', sws), h('div.nm', COLOURS.map((c) => c.name).join(', ')));
  }
  function linkMenu() {
    const r = ed.range(), a = (r?.startContainer?.nodeType === 1 ? r.startContainer : r?.startContainer?.parentElement)?.closest?.('a');
    const input = h('input.input', { type: 'text', placeholder: 'https://…', value: a?.getAttribute('href') ?? '', 'aria-label': 'Link address', 'data-qa': 'rte-link' });
    const err = h('div.cm-err', { role: 'alert' });
    const apply = () => {
      const href = safeHref(addressOf(input.value));
      if (!href) { err.textContent = 'Use an http or https address.'; return; }
      closeMenu();
      ed.exec((rg) => {
        const al = (rg?.startContainer?.nodeType === 1 ? rg.startContainer : rg?.startContainer?.parentElement)?.closest?.('a');
        if (al) al.setAttribute('href', href);
        else if (!rg || rg.collapsed) { const n = h('a', { href }, href); rg.insertNode(n); rg.setStartAfter(n); rg.collapse(true); } else document.execCommand('createLink', false, href);
      });
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    return h('div.cmenu.lk', { role: 'group', 'aria-label': 'Link' }, h('h5', 'Link'), input, err,
      h('div.lk-b', h('button.btn.sm.primary', { type: 'button', on: { click: apply } }, 'Apply'),
        a ? h('button.btn.sm', { type: 'button', on: { click: () => { closeMenu(); ed.exec(() => document.execCommand('unlink')); } } }, 'Remove link') : null));
  }
  function moreMenu() {
    const c = cellOf(ed.el, ed.range()?.startContainer), ops = c ? tableOps(c) : null;
    const item = (ic, text, fn, off = false) => h('button.om', { type: 'button', disabled: off, on: { mousedown: (e) => e.preventDefault(), click: fn } }, ic ? icon(ic) : null, text);
    return h('div.omenu', { role: 'menu' }, item('link', 'Link', () => { closeMenu(); setTimeout(() => toggleMenu(more, linkMenu), 0); }), item('table', 'Table 3×3', doTable),
      ops ? group.map((g) => item(null, g.label, op(g.op), !ops[g.can])) : null);
  }

  function update() {
    const on = (b, v) => b.setAttribute('aria-pressed', String(!!v)), q = (n) => { try { return document.queryCommandState(n); } catch { return false; } };
    const r = ed.range(), live = !!r;
    on(bold, live && q('bold')); on(italic, live && q('italic')); on(strike, live && q('strikeThrough')); on(ul, live && q('insertUnorderedList')); on(ol, live && q('insertOrderedList'));
    const cc = live ? colourAt(ed.el, r.startContainer) : null;
    bar.className = `abar${cc ? ` ${cc}` : ''}`;
    const c = live ? cellOf(ed.el, r.startContainer) : null;
    tg.hidden = !c;
    if (c) { const ops = tableOps(c); group.forEach((g) => { g.disabled = !ops[g.can]; }); }
  }
  const mark = () => { for (const b of el.querySelectorAll('button[aria-pressed]')) b.classList.toggle('on', b.getAttribute('aria-pressed') === 'true'); };
  const sync = () => { update(); mark(); };
  return { el, update: sync, closeMenu, dispose: () => { document.removeEventListener('mousedown', onDown); closeMenu(); } };
}
