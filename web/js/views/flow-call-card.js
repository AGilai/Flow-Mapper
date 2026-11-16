// The call card under the caption bar's step line (frame 28g): what the CALL does (short text), its contract (one line), an optional Watch, a link to the flow doc's
// callout for the same step, and, in Edit mode, "+ Add call description" with a small form. The text belongs to the call (flow-call-store.js), so every flow that
// uses it shows the same. Quiet when there is nothing: View mode draws nothing at all.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { me } from '../users/directory.js';
import { callOf } from './flow-call-store.js';
import { CALL_MAX } from '../../core/call-notes.js';

const lines = (t) => String(t ?? '').split('\n').filter(Boolean).map((l) => h('p', l));
const col = (title, ...body) => h('div.cc-col', h('h5', title), ...body);

/** createCallCard({ store, canEdit(), docLink(n) -> fn | null }) -> { el, paint(step | null, n), hasText(step), what(step), editing(), cancel() } */
export function createCallCard({ store, canEdit, quiet = () => false, docLink = () => null, onChange = () => {} }) {
  const el = h('div.cap-card', { 'data-qa': 'call-card', hidden: true });
  let step = null, n = 0, form = false;
  const call = () => callOf(step);
  const note = (st = step) => store.of(callOf(st))?.note ?? null;

  function open() { form = true; paint(step, n); el.querySelector('textarea')?.focus(); onChange(); }
  function cancel() { if (!form) return; form = false; paint(step, n); onChange(); }

  function editor(cur) {
    const what = h('textarea.cc-in', { rows: 2, maxLength: CALL_MAX.what, placeholder: 'Describe this call', 'aria-label': 'What it does', 'data-qa': 'cc-what' }, cur?.what ?? '');
    const contract = h('input.cc-in.mono', { type: 'text', maxLength: CALL_MAX.contract, placeholder: 'Request, response, errors', 'aria-label': 'Contract', 'data-qa': 'cc-contract', value: cur?.contract ?? '' });
    const wt = h('textarea.cc-in', { rows: 2, maxLength: CALL_MAX.watch, placeholder: 'What to watch for in this call', 'aria-label': 'Watch text', 'data-qa': 'cc-watch' }, cur?.watch.text ?? '');
    const on = h('input.vm-sw', { type: 'checkbox', role: 'switch', checked: !!cur?.watch.on, 'aria-label': 'Flag with ! in the diagram', 'data-qa': 'cc-watch-on', on: { change: () => sync() } });
    const err = h('span.cc-err', { role: 'alert' }), save = h('button.btn.sm.primary', { type: 'button', 'data-qa': 'cc-save' }, 'Save'), cancelB = h('button.btn.sm', { type: 'button', on: { click: cancel } }, 'Cancel');
    const sync = () => { wt.disabled = !on.checked; wt.closest('.cc-col')?.classList.toggle('off', !on.checked); };
    save.addEventListener('click', async () => {
      save.disabled = true; err.textContent = '';
      try { await store.save(call(), { what: what.value, contract: contract.value, watch: { on: on.checked, text: wt.value } }); form = false; paint(step, n); onChange(); }
      catch (e) { err.textContent = e.cancelled ? '' : e.message || 'Could not save.'; save.disabled = false; }
    });
    const key = (e) => { if (e.key === 'Escape') { e.stopPropagation(); cancel(); } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save.click(); };
    queueMicrotask(sync);
    return h('div.cc-form', { on: { keydown: key } },
      col('What it does', what), col('Contract', contract),
      col('Watch this call', h('label.cc-wrow', on, h('span', 'Flag with ! in the diagram')), wt),
      h('div.cc-act', err, cancelB, save));
  }

  function paint(st, num) {
    step = st; n = num;
    if (!st) { el.hidden = true; el.replaceChildren(); return; }
    const cur = note(), ed = canEdit() && !!callOf(st);
    if (form && ed) { el.hidden = false; el.replaceChildren(editor(cur)); return; }
    form = false;
    if (!cur) {
      const q = quiet(), show = ed && (!q || !!me()); // View mode: only a signed-in editor gets the one muted line
      el.hidden = !show;
      el.replaceChildren(show ? h(q ? 'button.cc-add.quiet' : 'button.cc-add', { type: 'button', 'data-qa': 'add-call-note', on: { click: open } }, ...(q ? ['+ describe this call'] : [icon('plus'), 'Add call description'])) : '');
      return;
    }
    const link = docLink(n), a = link ? h('a', { href: '#', 'data-qa': 'cc-doc', on: { click: (e) => { e.preventDefault(); link(); } } }, 'Flow doc') : null;
    el.hidden = false;
    el.replaceChildren(...[h('div.cc-grid',
      cur.what ? col('What it does', ...lines(cur.what)) : null,
      cur.contract ? col('Contract', h('p.mono', cur.contract)) : null,
      cur.watch.on ? h('div.cc-col.wt', h('h5', icon('warn'), 'Watch'), ...lines(cur.watch.text), a) : a ? col('Flow doc', h('p', 'A callout on this step: ', a)) : null),
    ed ? h('button.cc-edit', { type: 'button', 'data-qa': 'edit-call-note', 'aria-label': 'Edit call description', title: 'Edit this call’s description', on: { click: open } }, icon('edit')) : null].filter(Boolean));
  }
  return { el, paint, hasText: (st) => !!note(st), what: (st) => note(st)?.what ?? '', editing: () => form, cancel };
}
