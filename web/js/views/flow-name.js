// The flow's name (0.26.0): the name, or the entry key when it has none. Since frame 28 it is renamed on the tab (a pencil, or a double-click on the name; flow-tabs.js).
// Enter saves, Esc cancels, an empty name removes it. Where the write goes (decision D4): Edit mode with an open draft -> a draft op (applied with the draft);
// View mode or a sealed environment -> written at once (`PUT flow-names`, an annotation).

import { toast } from '../dom.js';
import { api } from '../api.js';
import { state, isDesign, setDesign } from '../state.js';
import { me } from '../design/who.js';
import { invalidateMarks } from '../design/marks-store.js';

/** Where a rename is written (pure): 'draft' | 'put'. */
export const nameTarget = (s = state, design = isDesign(s.env, s.envMeta)) => (design && s.mode === 'edit' && s.draft ? 'draft' : 'put');

/** The words shown as a flow's title: its name, else its entry key (pure). */
export const flowTitle = (name, entryKey) => (name && name.trim() ? name.trim() : entryKey);

/** Write a flow's name (where `nameTarget()` says), toast, and redraw the page. Nothing when it did not change. */
export async function saveName(root, name, next) {
  if (next === name) return;
  try {
    if (nameTarget() === 'draft') await api.designEdit(state.env, state.draft, { kind: 'flow', service: root.service, ingress: root.ingress, name: next }, me());
    else await api.setFlowName(state.env, { service: root.service, ingress: root.ingress, name: next, author: me() });
    toast(next ? `Named "${next}"` : 'Name removed');
    invalidateMarks(); setDesign({});
  } catch (err) { toast(err.message); }
}
