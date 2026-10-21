// The draft picker: a context-menu list of the open drafts of the environment (name, +a -r ~c, authors), "New draft..." and "No draft".

import { api } from '../api.js';
import { state, setDesign } from '../state.js';
import { toast } from '../dom.js';
import { openMenu } from '../components/context-menu.js';
import { askDialog } from './dialog.js';
import { me, deltaText } from './who.js';

/** The menu items for a list of drafts (pure: the callbacks come in). */
export function pickerItems(drafts, current, { onPick, onNew, onNone }) {
  return [
    { label: 'New draft…', icon: 'plus', onSelect: onNew },
    ...(drafts.length ? ['divider'] : []),
    ...drafts.map((d) => ({ label: d.slug === current ? `${d.name} (open)` : d.name, hint: `${deltaText(d.counts)} · ${d.authors.join(', ') || 'no changes yet'}`, onSelect: () => onPick(d) })),
    ...(current ? ['divider', { label: 'No draft', hint: `Look at ${state.env} itself`, onSelect: onNone }] : []),
  ];
}

export async function newDraft(edit = true) {
  const name = await askDialog({ title: 'New draft', body: 'A draft holds changes to this environment until you apply them. Others can add to it.', confirm: 'Create draft', input: { label: 'Name', placeholder: 'e.g. Device onboarding' } });
  if (!name) return;
  try {
    const d = await api.createDraft(state.env, name, me());
    setDesign({ draft: d.slug, mode: edit ? 'edit' : state.mode });
  } catch (err) { toast(err.message); }
}

/** Open the picker under `anchor`. `edit`: choosing a draft also switches to Edit (the toggle's case). `drafts` may be passed when the caller has them. */
export async function openDraftPicker(anchor, { edit = false, drafts = null } = {}) {
  let list = drafts;
  try { list ??= await api.drafts(state.env); } catch (err) { toast(err.message); return; }
  const r = anchor.getBoundingClientRect();
  const back = (e) => { if (e.key === 'Escape') setTimeout(() => anchor.focus()); removeEventListener('keydown', back, true); };
  addEventListener('keydown', back, true); setTimeout(() => removeEventListener('keydown', back, true), 20000);
  openMenu(r.left, r.bottom + 4, 'Drafts', pickerItems(list, state.draft, {
    onPick: (d) => setDesign({ draft: d.slug, mode: edit ? 'edit' : state.mode }),
    onNew: () => newDraft(edit),
    onNone: () => setDesign({ draft: null, mode: 'view' }),
  }));
}
