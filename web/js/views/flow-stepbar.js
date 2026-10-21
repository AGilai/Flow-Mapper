// The walk bar above the diagram (0.20.0): ‹ Step N of M ›, the step's label and ends, an aria-live announcement, and under it the step's
// description box (flow-head.js). Pure view of the state it is given: the walk itself (current step, keys, URL) lives in flow-walk-view.js.

import { h } from '../dom.js';
import { descDetails } from './flow-head.js';
import { announce } from './flow-walk.js';
import { stepCols } from './flow-steps.js';
import { cmpVar } from '../design/component-colors.js';

const dot = (c) => { const v = c?.kind === 'service' ? cmpVar(c.service, c.serviceKind) : null; return v ? h('span.cdot', { style: { '--cc': v }, 'aria-hidden': 'true' }) : null; };

/**
 * createStepbar({ store, root, onMove(action) }) -> { el, show(step|null, n, total), dispose }
 * root: { service, ingress } the step descriptions belong to, or null (no description box: a function tab).
 */
export function createStepbar({ store, root, onMove }) {
  const btn = (action, glyph, label) => h('button.stepnav', { type: 'button', 'aria-label': label, title: label, on: { click: () => onMove(action) } }, glyph);
  const prev = btn('prev', '‹', 'Previous step'), next = btn('next', '›', 'Next step');
  const count = h('span.stepcnt'), what = h('span.steplabel'), live = h('div.sr-only', { role: 'status', 'aria-live': 'polite' });
  const bar = h('div.stepbar', { role: 'group', 'aria-label': 'Step walk' }, prev, count, next, what, live);
  const descBox = h('div.stepdesc-host');
  const el = h('div.stepwalk', { hidden: true }, bar, descBox);
  let desc = null, shownKey = null;
  const clear = () => { desc?.dispose(); desc = null; descBox.replaceChildren(); };

  function show(step, n, total) {
    el.hidden = !step;
    if (!step) { clear(); shownKey = null; return; }
    count.textContent = `Step ${n} of ${total}`;
    prev.disabled = n <= 1; next.disabled = n >= total;
    const [a, b] = stepCols(step.event);
    what.replaceChildren(h('span.mono', step.label), ' ', dot(a), h('span.muted', `${step.from} → `), dot(b), h('span.muted', step.to));
    live.textContent = announce(n, total, `${step.label}, ${step.from} to ${step.to}`);
    if (!root || shownKey === step.key) return;
    shownKey = step.key; clear();
    desc = descDetails(store, root, step.key, { cls: 'stepdesc', remember: 'stepdesc-open', title: `Description of step ${n}`, quiet: true,
      summary: [h('span', 'Step description')] });
    descBox.append(desc.el);
  }
  return { el, show, dispose: clear };
}
