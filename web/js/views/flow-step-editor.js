// The step editor (0.30.0, frame 17c): a popover with the step's Title (optional, 80 characters) and Description (Human | AI tabs; the AI text is read-only,
// it comes in through MCP). Opened from the step bar, a step's pencil, the right-click menu, a double-click on a step's text, or the key E.
// Save / Cancel; Enter saves in Title, Ctrl/Cmd+Enter in Description; Esc cancels (asking first when something changed).

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { MAX_TITLE } from './step-details-pure.js';
import { fmtDate } from './flow-desc.js';

let current = null;

/** openStepEditor({ store, root, key, n, label, anchor, onClose }) -> { close() }. anchor: the element the popover hangs under (the step bar, or the step's row). */
export function openStepEditor({ store, root, key, n, label, anchor, onClose }) {
  current?.close(true);
  const opener = document.activeElement;
  const pair = () => store.peek(root)?.callees?.[key] ?? { human: null, ai: null };
  const p0 = pair(), t0 = p0.human?.title ?? '', d0 = p0.human?.text ?? '';
  const title = h('input.input', { type: 'text', maxLength: MAX_TITLE, 'aria-label': 'Step title', placeholder: p0.ai?.title ? `AI title: ${p0.ai.title}` : 'A short name for this step', value: t0 });
  const area = h('textarea.textarea', { rows: 4, maxLength: 4000, 'aria-label': 'Step description (Human)', placeholder: 'What this step does and why.' }, d0);
  const count = h('small.muted', `${t0.length}/${MAX_TITLE}`);
  title.addEventListener('input', () => { count.textContent = `${title.value.length}/${MAX_TITLE}`; });
  const err = h('span.small', { style: { color: 'var(--t-broken)' }, role: 'alert' });
  const dirty = () => title.value.trim() !== t0.trim() || area.value.trim() !== d0.trim();

  const ai = p0.ai;
  const aiPane = h('div.sted-ai', { hidden: true }, ai?.text ? [h('div.sted-meta', [h('span.ai', 'AI'), ' ', [ai.model, fmtDate(ai.generatedAt)].filter(Boolean).join(' · '), ai.outdated ? h('span.chip-warn', 'outdated') : null]),
    h('p', ai.text), h('small.muted', 'Written through MCP; not editable here. Your own text above always wins.')] : h('i.muted', 'No AI description for this step yet.'));
  const tabs = ['Human', 'AI'].map((name, i) => h('button.sted-tab', { type: 'button', role: 'tab', 'aria-selected': String(i === 0), on: { click: () => pick(i) } }, name));
  function pick(i) { tabs.forEach((b, k) => b.setAttribute('aria-selected', String(k === i))); area.hidden = i === 1; aiPane.hidden = i === 0; (i === 0 ? area : tabs[1]).focus(); }

  const save = h('button.btn.sm.primary', { type: 'button', on: { click: submit } }, 'Save');
  async function submit() {
    save.disabled = true; err.textContent = '';
    try { await store.save(root, key, area.value, title.value.trim()); close(); } catch (e) { err.textContent = e.message; save.disabled = false; }
  }
  const cancel = () => { if (!dirty() || confirm('Discard your changes to this step?')) close(); };
  const el = h('div.sted', { role: 'dialog', 'aria-label': `Edit step ${n}`, 'data-qa': 'step-editor' },
    h('div.sted-h', h('b', `Edit step ${n}`), h('span.mono.xs.muted', label), h('span.grow'), h('button.btn.sm.ghost', { type: 'button', 'aria-label': 'Close', on: { click: cancel } }, icon('close'))),
    h('div.sted-f', h('label', 'Title ', h('small.muted', '(optional)'), h('span.grow'), count), title),
    h('div.sted-f', h('div.sted-tabs', { role: 'tablist' }, ...tabs, h('small.muted', 'Empty text and title remove your note')), area, aiPane),
    h('div.sted-b', err, h('span.grow'), h('button.btn.sm', { type: 'button', on: { click: cancel } }, 'Cancel'), save));
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); cancel(); }
    else if (e.key === 'Enter' && e.target === title) { e.preventDefault(); submit(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && e.target === area) { e.preventDefault(); submit(); }
    e.stopPropagation(); // typing here never reaches the step walk (arrows, Home, End) or Maximize (F)
  });

  function place() {
    const r = anchor?.getBoundingClientRect?.() ?? { left: 40, bottom: 120, top: 80 }, narrow = innerWidth <= 760, w = narrow ? innerWidth - 24 : Math.min(460, innerWidth - 24);
    el.style.width = `${w}px`;
    el.style.left = `${narrow ? 12 : Math.max(12, Math.min(r.left + 16, innerWidth - w - 12))}px`;
    const below = r.bottom + 6, room = innerHeight - below - 12;
    el.style.top = `${room >= 240 ? below : Math.max(12, Math.min(below, innerHeight - el.offsetHeight - 12))}px`;
  }
  const onDown = (e) => { if (!el.contains(e.target) && !dirty() && !e.target.closest?.('.sd-menu')) close(); };
  function close(quiet = false) {
    document.removeEventListener('mousedown', onDown, true); removeEventListener('resize', place);
    el.remove(); if (current?.el === el) current = null;
    if (!quiet) { opener?.isConnected && opener.focus?.({ preventScroll: true }); onClose?.(); }
  }
  document.body.append(el); place();
  document.addEventListener('mousedown', onDown, true); addEventListener('resize', place);
  title.focus(); title.setSelectionRange(title.value.length, title.value.length);
  current = { close, el };
  return { close };
}
