// The step walk's two views (0.20.0, reworked 0.30.0 and 0.45.0, frame 28): the PLAYER, "‹ Step N of M ›", which lives in the toolbar (row 2), and the CAPTION BAR under the
// diagram, which follows the current step: its call line (title, API, route), the step's description (Markdown-lite; "Add a description" when it has none), the pencil that
// edits the step, and at its right the Read / Write legend and a close button. What the caption shows is the viewer's choice (`sb=`, step-details-pure.js); the whole bar, the legend
// and the description can be switched off in View > Descriptions (flow-caption-state.js). Pure view of the state it is given: the walk (current step, keys, URL) is flow-walk-view.js.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { announce, focusAfter } from './flow-walk.js';
import { stepCols } from './flow-steps.js';
import { stepText } from './flow-step-details.js';
import { colVar } from '../design/component-colors.js';
import { mdBlock } from './flow-md.js';
import { caps, onCaps, setCap } from './flow-caption-state.js';
import { createCallCard } from './flow-call-card.js';
import { callOf } from './flow-call-store.js';
import { readKey, writeKey } from './flow-info-pure.js';
import { state } from '../state.js';
import { watchUsers } from '../users/directory.js';

const dot = (c) => { const v = colVar(c); return v ? h('span.cdot', { style: { '--cc': v }, 'aria-hidden': 'true' }) : null; };

/**
 * createStepbar({ store, root, onMove(action), onEdit(anchor), sb() }) -> { nav, caption, bar (the caption: where the step editor hangs), legendSlot, show(step|null, n, total), refresh(), dispose }
 * root: { service, ingress } the step texts belong to, or null (a function tab: the API line only, no editing). sb(): the letters shown in the caption.
 */
export function createStepbar({ store, root, onMove, onEdit, sb = () => 'tad', extra = () => '', readOnly = false, calls = null, docLink = () => null }) { // readOnly: a tab of another environment shows the step texts without the way to edit them
  const btn = (action, glyph, label) => h('button.stepnav', { type: 'button', 'aria-label': label, title: label, on: { click: () => onMove(action) } }, glyph);
  const prev = btn('prev', '‹', 'Previous step'), next = btn('next', '›', 'Next step');
  const long = h('span.cnt-l'), short = h('span.cnt-s'), count = h('span.stepcnt', long, short), live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });
  const nav = h('div.player', { role: 'group', 'aria-label': 'Step walk', 'data-qa': 'step-player', hidden: true }, prev, count, next, live);

  const chip = h('span.cap-chip', icon('arrow'), h('span.cap-chip-t')), num = h('span.cap-n'), call = h('span.cap-call', { 'data-qa': 'step-title' });
  const ext = h('span.stepext.xs.muted', { 'data-qa': 'step-range' }), desc = h('div.cap-desc', { 'data-qa': 'step-detail' });
  const edit = root && !readOnly ? h('button.cap-edit', { type: 'button', 'data-qa': 'edit-step', 'aria-label': 'Edit step', title: 'Edit this step (E)', on: { click: () => onEdit?.(caption) } }, icon('edit')) : null;
  const more = h('button.cap-more', { type: 'button', 'aria-label': 'Show the whole description', 'aria-expanded': 'false', title: 'Show the whole description', hidden: true, on: { click: () => toggle() } }, icon('chevdown'));
  const legendSlot = h('span.cap-leg'), close = h('button.cap-x', { type: 'button', 'aria-label': 'Hide the caption bar', title: 'Hide the caption bar (View > Descriptions brings it back)', on: { click: () => setCap('caption', false) } }, icon('close'));
  const caption = h('div.capbar', { role: 'group', 'aria-label': 'Call notes', 'data-qa': 'caption-bar', hidden: true },
    h('div.cap-row', chip, num, call, ext, edit, desc, more, h('span.grow'), legendSlot, close));
  let last = null, data = null, total = 0, exp = false, cardOpen = readKey('callcard-open') !== '0', pv = null; // pv: the step a hovered arrow previews (frame 28g); cardOpen: the call card is expanded (remembered)
  const card = calls ? createCallCard({ store: calls, canEdit: () => true, quiet: () => state.mode !== 'edit', docLink, onChange: () => requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('fm:layout'))) }) : null;
  if (card) caption.append(card.el);
  const cardNote = () => !!card && !!last && card.hasText(pv ?? last.step);

  const toggle = (v = !exp) => {
    if (cardNote()) { cardOpen = !cardOpen; writeKey('callcard-open', cardOpen ? '1' : '0'); more.setAttribute('aria-expanded', String(cardOpen)); more.classList.toggle('up', cardOpen); paint(); document.dispatchEvent(new CustomEvent('fm:layout')); return; }
    exp = v; caption.classList.toggle('exp', exp); more.setAttribute('aria-expanded', String(exp)); more.classList.toggle('up', exp); };
  const clipped = () => { more.hidden = !(cardNote() || exp || desc.scrollWidth > desc.clientWidth + 1 || desc.scrollHeight > desc.clientHeight + 1); };
  const paintCaps = () => {
    const c = caps();
    caption.hidden = !c.caption || total < 1; legendSlot.hidden = !c.legend;
    desc.hidden = c.hideText || !desc.childNodes.length; if (c.hideText) toggle(false);
    requestAnimationFrame(clipped);
  };
  const off = onCaps(paintCaps);
  const unUsers = card ? watchUsers(() => { if (last) paint(); }) : () => {}; // signing in shows "+ describe this call"
  const unCalls = calls ? calls.watch(() => { if (last) paint(); }) : () => {};
  const unwatch = root ? store.watch(root, (d) => { data = d; if (last) paint(); }) : () => {};
  if (root && !readOnly) desc.addEventListener('dblclick', (e) => { if (!e.target.closest('a, button')) { getSelection()?.removeAllRanges(); onEdit?.(caption); } });
  desc.addEventListener('fm:md', () => requestAnimationFrame(clipped));

  function paint() {
    const { step, n } = pv ?? last, set = sb(), t = stepText(data, step.key), [a, b] = stepCols(step.event), parts = [];
    if (edit) edit.hidden = false;
    chip.hidden = false; num.hidden = false; num.textContent = String(n); chip.querySelector('.cap-chip-t').textContent = `Call · step ${n}`;
    call.replaceChildren(...[set.includes('t') && t.title ? h('b.cap-t', { title: t.title }, t.title) : null, set.includes('a') || !t.title ? h('span.mono.cap-api', { title: step.event?.msg?.label }, step.label) : null,
      h('span.cap-rt', dot(a), h('span.muted', `${step.from} → `), dot(b), h('span.muted', step.to)),
      step.transport === 'undecided' ? h('span.sb-tbd', { 'data-qa': 'step-tbd', title: 'The design has not decided how this call travels' }, 'transport not decided') : null].filter(Boolean));
    call.hidden = false;
    const cn = card?.hasText(step), what = card?.what(step) ?? '';
    if (cn && !cardOpen && what) parts.push(h('span.cap-what', { 'data-qa': 'call-what' }, what.replace(/\n+/g, ' '))); // collapsed: the call's text on the step line
    if (set.includes('d') && root) {
      if (!t.desc && !readOnly) { if (!calls) parts.push(h('span.cap-add', h('a', { href: '#', 'data-qa': 'add-description', on: { click: (e) => { e.preventDefault(); onEdit?.(caption); } } }, 'Add a description'))); } // with call notes the pencil edits the step text: no second "Add a description" prompt
      else if (t.desc) parts.push(t.who === 'ai' ? h('span.sb-ai', { title: 'Written by an AI tool through MCP' }, 'AI') : null, mdBlock(t.desc)); // Markdown-lite, as `about` (0.45.0)
    }
    desc.replaceChildren(...parts.filter(Boolean));
    if (card && !card.editing()) { card.paint(step, n); if (cn && !cardOpen) card.el.hidden = true; }
    more.setAttribute('aria-expanded', String(cn ? cardOpen : exp)); more.classList.toggle('up', cn ? cardOpen : exp); more.title = cn ? (cardOpen ? 'Collapse the call notes' : 'Expand the call notes') : 'Show the whole description';
    caption.classList.toggle('prev', !!pv); caption.classList.toggle('plain', !parts.length && !(card && !card.el.hidden));
    paintCaps();
    if (!pv) live.textContent = announce(n, last.total, `${t.title ? `${t.title}, ` : ''}${step.label}, ${step.from} to ${step.to}`);
  }

  /** Prev / Next that has focus and is about to be disabled hands focus to the other one, so the arrow keys keep working (a disabled button drops focus to <body>). */
  function setNav(n, tot) {
    const was = document.activeElement === prev ? 'prev' : document.activeElement === next ? 'next' : null, to = focusAfter(was, n, tot);
    prev.disabled = n < 1; next.disabled = n >= tot;
    if (to) (to === 'prev' ? prev : next).focus({ preventScroll: true });
  }

  function show(step, n, tot) {
    total = tot; ext.textContent = extra(); // "6–7 messages per path" while Both is chosen somewhere (0.38.0)
    nav.hidden = !step && !(tot > 0); // step 0 (none selected): the player shows "Step 0 of N" with Next only
    long.textContent = `Step ${step ? n : 0} of ${tot}`; short.textContent = `${step ? n : 0}/${tot}`; count.setAttribute('aria-label', `Step ${step ? n : 0} of ${tot}`);
    setNav(step ? n : 0, tot);
    if (!step) { // nothing chosen yet: the caption waits for a step
      last = null; pv = null; card?.paint(null, 0); if (edit) edit.hidden = true; chip.hidden = true; num.hidden = true; call.hidden = false; call.replaceChildren(h('span.muted', tot ? 'No step chosen. Use ‹ › or click an arrow.' : '')); desc.replaceChildren(); caption.classList.add('plain'); live.textContent = ''; paintCaps(); return;
    }
    last = { step, n, total: tot }; pv = null;
    paint();
  }
  /** A hovered arrow shows its call here, over the chosen step; null (the pointer left) puts the chosen step back. Ignored while a call note is being written. */
  function preview(st) {
    if (!last || card?.editing() || (st && st.n === last.n && !pv)) return;
    const next = st && st.n !== last.n ? { step: st, n: st.n } : null;
    if ((next?.n ?? null) === (pv?.n ?? null)) return;
    pv = next; paint();
  }
  return { nav, caption, bar: caption, preview, legendSlot, show, refresh: () => last && paint(), dispose: () => { unwatch(); off(); unCalls(); unUsers(); } };
}
