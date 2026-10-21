// Discard a draft: a confirm that names the count and the other authors. Resolves true when the draft was discarded.

import { api } from '../api.js';
import { state, setDesign } from '../state.js';
import { toast } from '../dom.js';
import { askDialog } from './dialog.js';
import { invalidateMarks } from './marks-store.js';
import { me, names } from './who.js';

/** "Discard 5 changes by you and Reviewer? ..." (pure). */
export function discardSentence(count, authors, you = me()) {
  const others = authors.filter((a) => a !== you);
  const by = others.length ? `${authors.includes(you) ? 'you and ' : ''}${names(others)}` : 'you';
  return `Discard ${count} change${count === 1 ? '' : 's'} by ${by}? The draft is closed and cannot be reopened.`;
}

export async function discardDraft(draft) {
  const total = draft.counts.added + draft.counts.removed + draft.counts.changed;
  const ok = await askDialog({ title: `Discard "${draft.name}"?`, body: discardSentence(total, draft.authors), confirm: 'Discard draft', danger: true });
  if (!ok) return false;
  try {
    await api.discardDraft(state.env, draft.slug, me());
  } catch (err) { toast(err.message); return false; }
  invalidateMarks();
  setDesign({ draft: null, mode: 'view' });
  toast(`Discarded "${draft.name}"`);
  return true;
}
