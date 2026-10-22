// The walk bar above the diagram (0.20.0, reworked 0.30.0, frame 17g): ‹ Step N of M ›, then the step itself: its title (bold), its API with the route, and its
// description (two lines, "more" opens it in place), and "Edit step" at the right. What shows is the viewer's choice (`sb=`, step-details-pure.js); an empty
// part collapses, and no description shows "Add a description". Pure view of the state it is given: the walk (current step, keys, URL) lives in flow-walk-view.js.

import { h } from '../dom.js';
import { announce } from './flow-walk.js';
import { stepCols } from './flow-steps.js';
import { stepText } from './flow-step-details.js';
import { colVar } from '../design/component-colors.js';

const dot = (c) => { const v = colVar(c); return v ? h('span.cdot', { style: { '--cc': v }, 'aria-hidden': 'true' }) : null; };

/**
 * createStepbar({ store, root, onMove(action), onEdit(anchor), sb() }) -> { el, show(step|null, n, total), refresh(), dispose }
 * root: { service, ingress } the step texts belong to, or null (a function tab: the API line only, no editing). sb(): the letters shown in the bar.
 */
export function createStepbar({ store, root, onMove, onEdit, sb = () => 'tad' }) {
  const btn = (action, glyph, label) => h('button.stepnav', { type: 'button', 'aria-label': label, title: label, on: { click: () => onMove(action) } }, glyph);
  const prev = btn('prev', '‹', 'Previous step'), next = btn('next', '›', 'Next step');
  const count = h('span.stepcnt'), live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });
  const detail = h('div.sb-det', { 'data-qa': 'step-detail' });
  const edit = root ? h('button.btn.sm.sb-edit', { type: 'button', 'data-qa': 'edit-step', title: 'Edit this step (E)', on: { click: () => onEdit?.(bar) } }, 'Edit step') : null;
  const bar = h('div.stepbar', { role: 'group', 'aria-label': 'Step walk' }, h('div.sb-nav', prev, count, next), detail, edit, live);
  const el = h('div.stepwalk', { hidden: true }, bar);
  let last = null, data = null, expanded = false, shownKey = null;
  const unwatch = root ? store.watch(root, (d) => { data = d; if (last) paint(); }) : () => {};
  if (root) detail.addEventListener('dblclick', (e) => { if (!e.target.closest('a, button')) { getSelection()?.removeAllRanges(); onEdit?.(bar); } });

  function paint() {
    const { step, n } = last, set = sb(), t = stepText(data, step.key), [a, b] = stepCols(step.event), parts = [];
    if (set.includes('t') && t.title) parts.push(h('div.sb-t', { title: t.title }, t.title));
    if (set.includes('a')) parts.push(h('div.sb-a', h('span.mono.sb-api', { title: step.event?.msg?.label }, step.label), h('span.sb-rt', dot(a), h('span.muted', `${step.from} → `), dot(b), h('span.muted', step.to)), step.transport === 'undecided' ? h('span.sb-tbd', { 'data-qa': 'step-tbd', title: 'The design has not decided how this call travels' }, 'transport not decided') : null));
    if (set.includes('d') && root) {
      if (!t.desc) parts.push(h('div.sb-x.add', h('a', { href: '#', 'data-qa': 'add-description', on: { click: (e) => { e.preventDefault(); onEdit?.(bar); } } }, 'Add a description')));
      else {
        const tx = h('span.tx', { title: expanded ? null : t.desc }, t.who === 'ai' ? h('span.sb-ai', { title: 'Written by an AI tool through MCP' }, 'AI') : null, t.desc), more = h('a.sb-more', { href: '#', hidden: true, on: { click: (e) => { e.preventDefault(); expanded = !expanded; paint(); } } }, expanded ? 'less' : '… more');
        parts.push(h('div.sb-x', { class: expanded ? 'open' : '' }, tx, ' ', more));
        requestAnimationFrame(() => { more.hidden = !expanded && tx.scrollHeight <= tx.clientHeight + 1; });
      }
    }
    detail.replaceChildren(...parts);
    detail.hidden = !parts.length;
    bar.classList.toggle('plain', !parts.length);
    bar.classList.toggle('first-line', parts.length > 0 && !(set.includes('t') && t.title));
    live.textContent = announce(n, last.total, `${t.title ? `${t.title}, ` : ''}${step.label}, ${step.from} to ${step.to}`);
  }

  function show(step, n, total) {
    el.hidden = !step;
    if (!step) { last = null; shownKey = null; return; }
    count.textContent = `Step ${n} of ${total}`;
    prev.disabled = n <= 1; next.disabled = n >= total;
    if (shownKey !== step.key) expanded = false;
    shownKey = step.key; last = { step, n, total };
    paint();
  }
  return { el, bar, show, refresh: () => last && paint(), dispose: unwatch };
}
