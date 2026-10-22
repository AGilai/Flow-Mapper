// What Notes add to the comment editor's toolbar (0.34.0, frame 20b): a Heading menu (Paragraph, Heading 2, Heading 3) and a step-chip button
// ("step #": the current step, or a range). Both keep the editor's selection like the other buttons (mousedown does not take focus).

import { h } from '../dom.js';
import { parseStepRef, stepRefText } from '../../core/notes.js';

const BLOCKS = [['p', 'Paragraph'], ['h2', 'Heading 2'], ['h3', 'Heading 3']];

/** The HTML of a step chip as the editor holds it: not editable text, written back as `<span data-step>`. */
export const chipHtml = (ref) => `<span data-step="${ref.to > ref.from ? `${ref.from}-${ref.to}` : ref.from}" contenteditable="false">${stepRefText(ref)}</span>&nbsp;`;

/** notesTools(ed, tb, { stepNow() -> { n } | null }) -> { update(), dispose() }: adds the buttons to the toolbar `tb` (createToolbar) of the editor `ed`. */
export function notesTools(ed, tb, { stepNow = () => null } = {}) {
  let menu = null;
  const close = () => { menu?.remove(); menu = null; head.setAttribute('aria-expanded', 'false'); stepBtn.setAttribute('aria-expanded', 'false'); };
  const place = (m, b) => { const bar = tb.el; m.style.top = `${bar.offsetTop + bar.offsetHeight + 2}px`; bar.parentElement.append(m); m.style.left = `${Math.max(0, Math.min(b.offsetLeft + bar.offsetLeft, bar.parentElement.clientWidth - m.offsetWidth - 4))}px`; };
  const open = (b, make) => {
    if (menu) { const same = menu.dataset.for === b.dataset.qa; close(); if (same) return; }
    menu = make(); menu.dataset.for = b.dataset.qa; b.setAttribute('aria-expanded', 'true'); place(menu, b);
    menu.querySelector('input, button')?.focus();
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); b.focus(); } });
  };
  const keep = (e) => e.preventDefault();
  const head = h('button.tbb.wide', { type: 'button', title: 'Paragraph style', 'aria-label': 'Paragraph style', 'aria-haspopup': 'true', 'aria-expanded': 'false', tabindex: -1, 'data-qa': 'nt-heading', on: { mousedown: keep, click: () => open(head, headMenu) } }, 'Paragraph ▾');
  const stepBtn = h('button.tbb.wide', { type: 'button', title: 'Insert a step chip', 'aria-label': 'Insert a step chip', 'aria-haspopup': 'true', 'aria-expanded': 'false', tabindex: -1, 'data-qa': 'nt-step-btn', on: { mousedown: keep, click: () => open(stepBtn, stepMenu) } }, 'step #');
  const block = (tag) => { close(); ed.exec(() => document.execCommand('formatBlock', false, tag)); update(); };
  function headMenu() {
    const cur = current();
    return h('div.omenu.nt-hm', { role: 'menu', 'aria-label': 'Paragraph style' }, BLOCKS.map(([t, label]) => h('button.om', { type: 'button', role: 'menuitemradio', 'aria-checked': String(t === cur), on: { mousedown: keep, click: () => block(t) } }, h('span.nt-mk', t === cur ? '✓' : ''), label)));
  }
  function stepMenu() {
    const n = stepNow()?.n ?? 1, a = h('input.input', { type: 'number', min: 1, max: 9999, value: n, 'aria-label': 'Step number', 'data-qa': 'nt-step-from' }), b = h('input.input', { type: 'number', min: 1, max: 9999, placeholder: 'to (optional)', 'aria-label': 'Last step of a range', 'data-qa': 'nt-step-to' });
    const err = h('div.cm-err', { role: 'alert' });
    const apply = () => {
      const ref = parseStepRef(b.value ? `${a.value}-${b.value}` : a.value);
      if (!ref) { err.textContent = 'Give a step number (and a later one for a range).'; return; }
      close(); ed.exec(() => document.execCommand('insertHTML', false, chipHtml(ref)));
    };
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } };
    a.addEventListener('keydown', onKey); b.addEventListener('keydown', onKey);
    return h('div.cmenu.nt-sm', { role: 'group', 'aria-label': 'Step chip' }, h('h5', 'Link a step'), h('div.nt-sr', a, h('span', '–'), b), err, h('div.lk-b', h('button.btn.sm.primary', { type: 'button', on: { click: apply } }, 'Insert')));
  }
  const current = () => { let v = ''; try { v = String(document.queryCommandValue('formatBlock') || '').toLowerCase().replace(/[<>]/g, ''); } catch { /* none */ } return v === 'h2' || v === 'h3' ? v : 'p'; };
  function update() { head.firstChild.textContent = `${BLOCKS.find(([t]) => t === current())[1]} ▾`; }
  const first = tb.el.firstChild;
  tb.el.insertBefore(head, first); tb.el.insertBefore(h('span.tbsep', { 'aria-hidden': 'true' }), first);
  tb.el.insertBefore(stepBtn, tb.el.querySelector('.tb-more'));
  const onDown = (e) => { if (menu && !menu.contains(e.target) && !head.contains(e.target) && !stepBtn.contains(e.target)) close(); };
  document.addEventListener('mousedown', onDown);
  return { update, dispose: () => { document.removeEventListener('mousedown', onDown); close(); } };
}
