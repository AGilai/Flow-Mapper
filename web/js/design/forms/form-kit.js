// What every edit form shares (0.26.0): the panel frame (chips, title, sub), `.fgrid` rows with inline errors from `EditError.field`,
// Done / Delete / Cancel, and the one save: a single `designEdit` call, then "Saved to draft <name>" and the page draws again.
// Keyboard: Enter in a one-line field is Done, Esc closes (the panel), Tab walks the fields in order. Delete always asks first.

import { h, fill, toast } from '../../dom.js';
import { api } from '../../api.js';
import { state } from '../../state.js';
import { me } from '../who.js';
import { askDialog } from '../dialog.js';
import { afterEdit } from '../after-edit.js';

/** Rows of a `.fgrid`: field(key, label, control, hint) registers the inline error slot of `key`. */
export function createFields() {
  const errs = new Map(), rows = [];
  return {
    rows,
    field(key, label, control, hint = null) {
      const err = h('div.ferr', { role: 'alert', 'data-err': key });
      errs.set(key, { err, control });
      const id = `f-${key}`;
      control.id ||= id;
      rows.push(h('label.flab', { for: control.id }, label), h('div.fctl', control, hint ? h('small.fhint', hint) : null, err));
    },
    wide(node) { rows.push(h('div.fwide', node)); },
    clear() { errs.forEach(({ err, control }) => { err.textContent = ''; control.removeAttribute?.('aria-invalid'); }); },
    /** Show `message` under `field`; false when this form has no such field. */
    show(field, message) {
      const e = errs.get(field);
      if (!e) return false;
      e.err.textContent = message; e.control.setAttribute?.('aria-invalid', 'true'); e.control.focus?.();
      return true;
    },
  };
}

/** A neutral kind chip for a form's head. */
export const tag = (text, transport = null) => (transport ? h('span.chip', { 'data-t': transport }, text) : h('span.pill', text));
export const select = (options, value, extra = {}) => h('select.select', extra, options.map((o) => { const [v, label] = Array.isArray(o) ? o : [o, o]; return h('option', { value: v, selected: v === value }, label); }));
export const input = (value = '', { placeholder = '', mono = false, readOnly = false, ...rest } = {}) => h('input.input', { type: 'text', value, placeholder, readOnly, class: mono ? 'mono' : '', autocomplete: 'off', spellcheck: false, ...rest });
export const textarea = (value = '', rows = 3) => h('textarea.textarea', { rows, value });

/**
 * openForm({ panel, flowsEl, chips, title, sub, fields, top, build, remove, doneLabel, saved }) -> { error(msg) }
 * build(): the DesignEdit to send (throws { field, message } for a mistake the form can see itself).
 * remove: { label, title, body, edit } -> Delete asks, then sends `edit`.
 */
export function openForm({ panel, flowsEl, chips = [], title, sub, fields, top = null, build, remove = null, doneLabel = 'Done' }) {
  const box = h('div.error-box', { hidden: true, role: 'alert', 'data-qa': 'form-error' });
  const done = h('button.btn.primary', { type: 'button', 'data-qa': 'form-done' }, doneLabel);
  const cancel = h('button.btn', { type: 'button', on: { click: () => panel.close() } }, 'Cancel');
  const del = remove ? h('button.btn.danger-ghost', { type: 'button', 'data-qa': 'form-delete' }, remove.label ?? 'Delete') : null;
  const body = h('div.ep-pad.form-pane', { 'data-qa': 'edit-form', on: { keydown: (e) => { if (e.key === 'Enter' && e.target.matches?.('input.input')) { e.preventDefault(); done.click(); } } } },
    top, h('div.fgrid', fields.rows), box, h('div.imp-acts', del, h('span.grow'), cancel, done));
  const problem = (msg) => { box.hidden = !msg; box.textContent = msg ?? ''; };

  async function send(edit, button) {
    fields.clear(); problem(null); button.disabled = true;
    try {
      const out = await api.designEdit(state.env, state.draft, edit, me());
      toast(`Saved to draft ${state.draft}`);
      panel.close();
      afterEdit();
      return out;
    } catch (err) {
      button.disabled = false;
      const f = err.field ?? err.details?.field;
      if (!(f && fields.show(f, err.message))) problem(err.message);
      return null;
    }
  }
  done.addEventListener('click', () => {
    let edit;
    try { edit = build(); } catch (err) { fields.clear(); if (!(err.field && fields.show(err.field, err.message))) problem(err.message); return; }
    send(edit, done);
  });
  del?.addEventListener('click', async () => {
    const ok = await askDialog({ title: remove.title, body: remove.body, confirm: remove.label ?? 'Delete', danger: true, focus: 'cancel' });
    if (ok) send(remove.edit, del);
  });
  flowsEl?.classList.add('mp-open');
  panel.open(h('div.ep-head', h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, chips), h('h3', title), sub ? h('span.xs.muted', sub) : null), body);
  body.querySelector('input:not([readonly]),select,textarea')?.focus();
  return { error: problem };
}
