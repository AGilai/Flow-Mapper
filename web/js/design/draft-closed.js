// #118: a page pointed at a draft that is no longer open (a link made before the apply, or a draft applied in another tab or by the API).
// The page drops the draft from its state and URL, reads the environment as it is now (the applied changes are part of it), and the strip shows a
// read-only notice in place of the draft bar. `closedOf` asks the server; `dropClosed` is the one place that clears the draft.

import { h } from '../dom.js';
import { api } from '../api.js';
import { state, setDesign } from '../state.js';

/** null while the draft is open (or the server cannot say); else what the notice shows. A draft that is gone (404) reads as 'missing'. */
export async function closedOf(env, slug) {
  try {
    const d = await api.draft(env, slug);
    return d.status === 'open' ? null : { slug, status: d.status, closedAt: d.closedAt, closedBy: d.closedBy, changelogId: d.changelogId };
  } catch (err) { return err.status === 404 ? { slug, status: 'missing' } : null; }
}

/** The page's draft turned out closed: forget it (state and URL) and show the notice. `refresh` false when the caller renders next anyway. */
export function dropClosed(info, refresh = true) {
  state.closedDraft = info;
  if (refresh) setDesign({ draft: null, mode: 'view' }); else { state.draft = null; state.mode = 'view'; }
}

/** After a refused write or apply (DRAFT_CLOSED): look the draft up again and, if it is closed, drop it. */
export async function checkOpenDraft() {
  const slug = state.draft;
  if (!slug) return;
  const c = await closedOf(state.env, slug);
  if (c && state.draft === slug) dropClosed(c);
}

/** The read-only notice: no Apply, Edit or Discard. */
export function closedNotice(c, onDismiss) {
  const when = c.closedAt ? ` ${c.closedAt.slice(0, 16).replace('T', ' ')} UTC` : '', by = c.closedBy && c.closedBy !== 'anonymous' ? ` by ${c.closedBy}` : '';
  const text = c.status === 'applied' ? `✓ Draft ${c.slug} was applied${when}${by}${c.changelogId ? ` (changelog ${c.changelogId})` : ''}. ${state.env} below already includes its changes.`
    : c.status === 'discarded' ? `Draft ${c.slug} was discarded${when}${by}. ${state.env} below is the environment without it.`
      : `Draft ${c.slug} does not exist. ${state.env} below is shown without it.`;
  return h('div.dz-callout.dz-closed' + (c.status === 'applied' ? '.ok' : ''), { role: 'note', 'data-qa': 'draft-closed' }, text + ' ',
    h('button.btn.sm', { type: 'button', 'data-qa': 'draft-closed-dismiss', on: { click: onDismiss } }, 'View the environment without the draft'));
}
