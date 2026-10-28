// The text of the "About this flow" region (0.46.0, #95): the flow's description, full width, Markdown-lite, clamped to four lines with a clean cut (CSS line-clamp).
// The Human note wins over the AI text; the AI text shows when there is no note, or under a small "AI description" disclosure. No Generate row, no click-to-edit.
// Editing is the Human note's textarea (noteEditor). With no text: "No description yet · Write one".

import { h } from '../dom.js';
import { noteEditor, pairOf, fmtDate } from './flow-desc.js';
import { mdBlock } from './flow-md.js';

/**
 * aboutText(store, root, { title, onChange }) -> { el, edit(), hasText(), editing(), preview(), clipped(), setClamp(on), dispose }.
 * onChange(): the text, the editing state or the layout changed (the header repaints).
 */
export function aboutText(store, root, { title, onChange }) {
  const el = h('div.fab-txt', { 'data-qa': 'about-text' });
  let data = null, editing = false, clamp = true, aiOpen = false, md = null;
  const start = (e) => { e?.preventDefault(); if (!editing) { editing = true; render(); onChange(); } };
  const pair = () => pairOf(data, null);
  const textOf = (p) => (p.human?.text ?? p.ai?.text ?? '');

  function render() {
    if (editing && el.querySelector('.editing')) return;
    const p = pair();
    md = null;
    if (editing) {
      const ed = noteEditor({ initial: p.human?.text, label: `Human note: ${title}`, onCancel: () => { editing = false; render(); onChange(); },
        onSave: async (t) => { await store.save(root, null, t); editing = false; render(); onChange(); } });
      el.replaceChildren(ed.el); queueMicrotask(() => ed.focus());
      return;
    }
    if (!p.human && !p.ai) { el.replaceChildren(h('p.fab-empty', data ? 'No description yet · ' : 'Loading…', data ? h('a', { href: '#', on: { click: start } }, 'Write one') : null)); return; }
    const a = p.ai;
    md = mdBlock(textOf(p), clamp ? 'fab-md clamped' : 'fab-md');
    const meta = p.human
      ? [p.human.editedBy === 'draft' ? 'From the draft' : [p.human.editedBy && p.human.editedBy !== 'web' ? p.human.editedBy : null, fmtDate(p.human.editedAt)].filter(Boolean).join(' · ')]
      : [h('span.ai', 'AI'), [a.model, fmtDate(a.generatedAt)].filter(Boolean).join(' · '), a.outdated ? h('span.chip-warn', { title: 'The flow has changed since this was written. Generate it again to bring it up to date.' }, 'outdated') : null];
    el.replaceChildren(...[md, h('div.fab-meta', ...meta,
      p.human && a ? h('button.linkish', { type: 'button', 'aria-expanded': String(aiOpen), on: { click: () => { aiOpen = !aiOpen; render(); onChange(); } } }, aiOpen ? 'Hide the AI description' : 'AI description', a.outdated ? ' (outdated)' : '') : null),
    p.human && a && aiOpen ? h('div.fab-ai', mdBlock(a.text, 'fab-md')) : null].filter(Boolean));
  }
  render();
  const unwatch = store.watch(root, (d) => { data = d; if (!editing) render(); onChange(); });
  return {
    el, edit: start, dispose: unwatch,
    hasText: () => !!(data && (pair().human || pair().ai)),
    editing: () => editing,
    preview: () => textOf(pair()),
    clipped: () => !!md && md.scrollHeight > md.clientHeight + 2,
    setClamp: (on) => { clamp = on; md?.classList.toggle('clamped', on); },
  };
}
