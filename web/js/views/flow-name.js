// The flow's name as the title of its page (0.26.0): the name, or the entry key when it has none, with a pencil to rename it in place.
// Enter saves, Esc cancels, an empty name removes it ("Name this flow" shows while unnamed). Where the write goes (decision D4): Edit mode with
// an open draft -> a draft op (applied with the draft); View mode or a sealed environment -> written at once (`PUT flow-names`, an annotation).

import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { state, isDesign, setDesign } from '../state.js';
import { me } from '../design/who.js';
import { invalidateMarks } from '../design/marks-store.js';

/** Where a rename is written (pure): 'draft' | 'put'. */
export const nameTarget = (s = state, design = isDesign(s.env, s.envMeta)) => (design && s.mode === 'edit' && s.draft ? 'draft' : 'put');

/** The words shown as a flow's title: its name, else its entry key (pure). */
export const flowTitle = (name, entryKey) => (name && name.trim() ? name.trim() : entryKey);

/** nameEditor({ root: {service, ingress}, name, fallback, readOnly }) -> { el }: the title text and its pencil (none for a tab of another environment). */
export function nameEditor({ root, name = '', fallback, readOnly = false }) {
  const title = h('span.fh-t', { 'data-qa': 'flow-title' }, flowTitle(name, fallback));
  if (readOnly) return { el: h('span.fl-name', title) };
  const pencil = h('button.btn.ghost.fl-pencil', { type: 'button', 'data-qa': 'rename-flow', title: name ? 'Rename this flow' : 'Name this flow', 'aria-label': name ? 'Rename this flow' : 'Name this flow',
    on: { click: (e) => { e.preventDefault(); e.stopPropagation(); edit(); } } }, name ? '✎' : 'Name this flow');
  const el = h('span.fl-name', title, pencil);
  function edit() {
    const input = h('input.input', { type: 'text', value: name, maxLength: 200, 'aria-label': 'Flow name', placeholder: 'Name this flow', 'data-qa': 'flow-name-input' });
    const done = (save) => { el.replaceChildren(title, pencil); if (save) commit(input.value.trim()); else pencil.focus(); };
    input.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); done(true); } else if (e.key === 'Escape') { e.preventDefault(); done(false); } });
    input.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
    input.addEventListener('keyup', (e) => e.stopPropagation());
    el.replaceChildren(input); input.focus(); input.select();
  }
  async function commit(next) {
    if (next === name) return;
    try {
      if (nameTarget() === 'draft') await api.designEdit(state.env, state.draft, { kind: 'flow', service: root.service, ingress: root.ingress, name: next }, me());
      else await api.setFlowName(state.env, { service: root.service, ingress: root.ingress, name: next, author: me() });
      toast(next ? `Named "${next}"` : 'Name removed');
      invalidateMarks(); setDesign({});
    } catch (err) { toast(err.message); }
  }
  return { el };
}
