// The walk bar above the diagram (0.20.0, reworked 0.30.0, frame 17g): ‹ Step N of M ›, then the step itself: its title (bold), its API with the route, and its
// description, and "Edit step" at the right (0.45.0: title, A− / A+ and Hide text share the top row; the description is Markdown-lite at full width). What shows is the viewer's choice (`sb=`, step-details-pure.js); an empty
// part collapses, and no description shows "Add a description". Pure view of the state it is given: the walk (current step, keys, URL) lives in flow-walk-view.js.

import { h } from '../dom.js';
import { announce, focusAfter } from './flow-walk.js';
import { stepCols } from './flow-steps.js';
import { stepText } from './flow-step-details.js';
import { colVar } from '../design/component-colors.js';
import { mdBlock } from './flow-md.js';
import { sizeControl } from './flow-textsize.js';
import { textHidden, textHiddenSave } from './flow-info-pure.js';

const dot = (c) => { const v = colVar(c); return v ? h('span.cdot', { style: { '--cc': v }, 'aria-hidden': 'true' }) : null; };

/**
 * createStepbar({ store, root, onMove(action), onEdit(anchor), sb() }) -> { el, show(step|null, n, total), refresh(), dispose }
 * root: { service, ingress } the step texts belong to, or null (a function tab: the API line only, no editing). sb(): the letters shown in the bar.
 */
export function createStepbar({ store, root, onMove, onEdit, sb = () => 'tad', extra = () => '', readOnly = false }) { // readOnly: a tab of another environment shows the step texts without the way to edit them
  const btn = (action, glyph, label) => h('button.stepnav', { type: 'button', 'aria-label': label, title: label, on: { click: () => onMove(action) } }, glyph);
  const prev = btn('prev', '‹', 'Previous step'), next = btn('next', '›', 'Next step');
  const count = h('span.stepcnt'), ext = h('span.stepext.xs.muted', { 'data-qa': 'step-range' }), live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });
  const detail = h('div.sb-det', { 'data-qa': 'step-detail' }), ttl = h('div.sb-t', { 'data-qa': 'step-title' });
  const size = sizeControl();
  let hidden = textHidden();
  const hide = h('button.sb-hide', { type: 'button', 'data-qa': 'hide-text', on: { click: () => { hidden = !hidden; textHiddenSave(hidden); paintHide(); } } });
  const edit = root && !readOnly ? h('button.btn.sm.sb-edit', { type: 'button', 'data-qa': 'edit-step', title: 'Edit this step (E)', on: { click: () => onEdit?.(bar) } }, 'Edit step') : null;
  // 0.45.0 (#91, frame 25): full width. The top row holds the walk, the title and the tools; the API line and the description use the whole width below it.
  const bar = h('div.stepbar', { role: 'group', 'aria-label': 'Step walk' }, h('div.sb-top', h('div.sb-nav', prev, count, next, ext), ttl, h('span.grow'), h('div.sb-tools', size.el, hide, edit)), detail, live);
  const el = h('div.stepwalk', { hidden: true }, bar);
  let last = null, data = null;
  function paintHide() {
    hide.textContent = hidden ? 'Show text' : 'Hide text'; hide.setAttribute('aria-expanded', String(!hidden));
    bar.classList.toggle('text-off', hidden); detail.hidden = hidden || !detail.childNodes.length;
  }
  paintHide();
  const unwatch = root ? store.watch(root, (d) => { data = d; if (last) paint(); }) : () => {};
  if (root && !readOnly) detail.addEventListener('dblclick', (e) => { if (!e.target.closest('a, button')) { getSelection()?.removeAllRanges(); onEdit?.(bar); } });

  function paint() {
    const { step, n } = last, set = sb(), t = stepText(data, step.key), [a, b] = stepCols(step.event), parts = [];
    ttl.textContent = set.includes('t') ? t.title : ''; ttl.title = ttl.textContent; ttl.hidden = !ttl.textContent;
    if (set.includes('a')) parts.push(h('div.sb-a', h('span.mono.sb-api', { title: step.event?.msg?.label }, step.label), h('span.sb-rt', dot(a), h('span.muted', `${step.from} → `), dot(b), h('span.muted', step.to)), step.transport === 'undecided' ? h('span.sb-tbd', { 'data-qa': 'step-tbd', title: 'The design has not decided how this call travels' }, 'transport not decided') : null));
    if (set.includes('d') && root) {
      if (!t.desc && !readOnly) parts.push(h('div.sb-x.add', h('a', { href: '#', 'data-qa': 'add-description', on: { click: (e) => { e.preventDefault(); onEdit?.(bar); } } }, 'Add a description')));
      else parts.push(h('div.sb-x', t.who === 'ai' ? h('span.sb-ai', { title: 'Written by an AI tool through MCP' }, 'AI') : null, mdBlock(t.desc))); // Markdown-lite, as `about` (0.45.0)
    }
    detail.replaceChildren(...parts);
    bar.classList.toggle('plain', !parts.length);
    paintHide();
    live.textContent = announce(n, last.total, `${t.title ? `${t.title}, ` : ''}${step.label}, ${step.from} to ${step.to}`);
  }

  /** Prev / Next that has focus and is about to be disabled hands focus to the other one, so the arrow keys keep working (a disabled button drops focus to <body>). */
  function setNav(n, total) {
    const was = document.activeElement === prev ? 'prev' : document.activeElement === next ? 'next' : null, to = focusAfter(was, n, total);
    prev.disabled = n < 1; next.disabled = n >= total;
    if (to) (to === 'prev' ? prev : next).focus({ preventScroll: true });
  }

  function show(step, n, total) {
    ext.textContent = extra(); // "6–7 messages per path" while Both is chosen somewhere (0.38.0)
    el.hidden = !step && !(total > 0); // step 0 (none selected): the bar shows "Step 0 of N" with Next only
    if (!step) { last = null; ttl.hidden = true; count.textContent = `Step 0 of ${total}`; setNav(0, total); detail.replaceChildren(); detail.hidden = true; ttl.textContent = ''; bar.classList.add('plain'); live.textContent = ''; if (edit) edit.style.display = 'none'; return; }
    if (edit) edit.style.display = '';
    count.textContent = `Step ${n} of ${total}`;
    setNav(n, total);
    last = { step, n, total };
    paint();
  }
  return { el, bar, show, refresh: () => last && paint(), dispose: () => { unwatch(); size.dispose(); } };
}
