// "Review changes": the draft's changes (GET /changes) grouped by component, each with its mark, an indented row for the children of an added
// or removed component, a Revert per item and Undo last. In confirm mode it ends with "Apply N changes to <env>".

import { h } from '../dom.js';
import { api } from '../api.js';
import { state, setDesign } from '../state.js';
import { href } from '../router.js';
import { glyph } from '../components/status-mark.js';
import { askDialog } from './dialog.js';
import { invalidateMarks } from './marks-store.js';
import { me } from './who.js';
import { groupChanges, kindWord } from './changes-group.js';

const MARK = { added: 'new', changed: 'changed', removed: 'removed' };
const WORD = { added: 'Added', changed: 'Changed', removed: 'Removed' };

function row(it, draft, after) {
  const revert = it.under ? null : h('button.btn.sm.ghost', { type: 'button', 'data-qa': 'revert', title: `Drop this draft's changes to ${it.label}`,
    on: { click: async () => { await api.revertDraftItem(state.env, draft.slug, it.anchor); invalidateMarks(); after(); } } }, 'Revert');
  return h('li.dz-row', { class: it.under ? 'under' : '', 'data-change': it.change },
    h(`span.mark.${{ added: 'new', changed: 'chg', removed: 'rm' }[it.change]}`, glyph(MARK[it.change]), WORD[it.change]),
    h('span.dz-kind', kindWord(it.anchor)), h('code.key', it.label),
    it.stale ? h('span.dz-stale', { title: `${state.env} changed this item since the draft first touched it` }, 'changed in the environment since') : null,
    h('span.dz-by.muted.xs', it.authors.join(', ')), h('span.spacer'), revert);
}

/**
 * reviewPanel({ draft, changes, confirm, onClose, refresh }) -> element. `draft`: DraftInfo; `changes`: the /changes payload.
 * confirm: the Apply step (ends with the primary button).
 */
export function reviewPanel({ draft, changes, confirm = false, onClose, refresh }) {
  const total = changes.counts.added + changes.counts.removed + changes.counts.changed;
  const stale = changes.items.filter((i) => i.stale && !i.under);
  const groups = groupChanges(changes.items);
  const apply = h('button.btn.primary', { type: 'button', 'data-qa': 'apply-confirm', disabled: !total, on: { click: async () => {
    apply.disabled = true; apply.textContent = 'Applying…';
    try { await applyDraft(draft, total); } catch (err) { apply.disabled = false; apply.textContent = `Apply ${total} changes to ${state.env}`; footer.prepend(h('div.error-box', err.message)); }
  } } }, `Apply ${total} change${total === 1 ? '' : 's'} to ${state.env}`);
  const footer = h('div.dz-review-foot', confirm ? [h('button.btn', { type: 'button', on: { click: onClose } }, 'Cancel'), apply] : null);
  return h('section.dz-review', { 'data-qa': 'draft-review', 'aria-label': `Changes in ${draft.name}` },
    h('div.dz-review-head', h('h3', confirm ? `Apply "${draft.name}" to ${state.env}` : 'Review changes'),
      h('span.spacer'),
      !confirm && total ? h('button.btn.sm', { type: 'button', 'data-qa': 'undo-last', on: { click: async () => { await api.undoDraft(state.env, draft.slug); invalidateMarks(); refresh(); } } }, 'Undo last change') : null,
      h('button.btn.sm.ghost', { type: 'button', 'aria-label': 'Close the review', on: { click: onClose } }, 'Close')),
    confirm && stale.length ? h('div.dz-callout', { role: 'note' }, `${stale.length} item${stale.length === 1 ? '' : 's'} changed in ${state.env} since this draft touched ${stale.length === 1 ? 'it' : 'them'}. Apply overwrites ${stale.length === 1 ? 'it' : 'them'}: ${stale.map((s) => s.label).join(', ')}.`) : null,
    h('div.dz-review-scroll', total ? groups.map((g) => h('div.dz-group', h('h4', g.service ? h('a', { href: href(`/services/${encodeURIComponent(g.service)}`) }, g.service) : 'Shared items'),
      h('ul.dz-list', g.items.map((it) => row(it, draft, refresh)))))
      : h('p.fd-empty', 'No changes yet.')),
    footer);
}

/** Apply for real; the report says what it overwrote. Leaves the draft (View mode) afterwards. */
export async function applyDraft(draft, total) {
  const out = await api.applyDraft(state.env, draft.slug, me());
  invalidateMarks();
  const touched = [...new Set((out.results ?? []).map((r) => r.service).filter(Boolean))];
  const replaced = out.replaced ?? [];
  setDesign({ draft: null, mode: 'view' });
  await askDialog({ title: `Applied ${total} change${total === 1 ? '' : 's'} to ${state.env}`, confirm: 'Done', cancel: null, body: h('div.dz-report',
    h('p', touched.length ? `Updated ${touched.length} component${touched.length === 1 ? '' : 's'}: ${touched.join(', ')}.` : 'Updated the environment.'),
    replaced.length ? h('div.dz-callout', { role: 'note' }, h('b', `Overwrote ${replaced.length} item${replaced.length === 1 ? '' : 's'} that changed in ${state.env} after the draft touched ${replaced.length === 1 ? 'it' : 'them'}`),
      h('ul', replaced.map((r) => h('li', h('code.key', r.anchor))))) : h('p.muted', 'Nothing was overwritten.'),
    touched[0] ? h('p', h('a', { href: href(`/services/${encodeURIComponent(touched[0])}`) }, 'Open the changelog')) : null) });
}
