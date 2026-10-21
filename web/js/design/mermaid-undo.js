// The line under the draft bar after a Mermaid import (frame 14e): what came in, "Review changes" and "Undo import". The import is one batch of ops
// (`origin.batch`), so Undo removes exactly those; the server answers 409 DEPENDENT_OPS when a later op in the draft depends on them. Kept per tab.

import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { go, parseHash } from '../router.js';
import { invalidateMarks } from './marks-store.js';
import { afterEdit } from './after-edit.js';

let last = null;
/** { draft, batch, flow: 'service/ingress', text } of the import just made; one at a time. */
export const setLastImport = (v) => { last = v; };
export const lastImport = () => (last && last.draft === state.draft ? last : null);

/** The "Imported from Mermaid" line, or null. onReview opens the review panel. */
export function importedLine({ onReview }) {
  const l = lastImport();
  if (!l) return null;
  const undo = async (btn) => {
    btn.disabled = true;
    try {
      await api.undoMermaid(state.env, l.draft, l.batch); last = null; toast('Import undone');
      const { query } = parseHash(), tabs = (query.get('tabs') ?? '').split(',').filter((k) => k && k !== l.flow);
      if (tabs.length !== (query.get('tabs') ?? '').split(',').filter(Boolean).length) { invalidateMarks(); go('/flows', { env: state.env, draft: state.draft, mode: state.mode === 'edit' ? 'edit' : null, tabs: tabs.join(',') }); }   // the flow it made is gone: its tab goes too
      else afterEdit();
    }
    catch (e) {
      btn.disabled = false;
      const n = e.details?.blocking?.length;
      toast(e.code === 'DEPENDENT_OPS' ? `Cannot undo: ${n} later change${n === 1 ? '' : 's'} in the draft depend on this import (${e.details.blocking[0].anchor}). Undo or revert them first.` : e.message, 6000);
    }
  };
  return h('div.dz-imported', { role: 'status', 'data-qa': 'mermaid-imported' }, h('span.dz-imported-t', l.text),
    h('button.btn.sm', { type: 'button', on: { click: onReview } }, 'Review changes'),
    h('button.btn.sm', { type: 'button', 'data-qa': 'mermaid-undo', title: 'Remove what this import added', on: { click: (e) => undo(e.currentTarget) } }, 'Undo import'),
    h('button.btn.sm.ghost', { type: 'button', 'aria-label': 'Dismiss', title: 'Dismiss', on: { click: (e) => { last = null; e.currentTarget.closest('.dz-imported').remove(); } } }, '×'));
}
