// A small modal for the design chrome: confirm (a sentence, two buttons) or prompt (one text field). Resolves to true / the text, or null on cancel.

import { h } from '../dom.js';

/** askDialog({ title, body, confirm, cancel?, input?: { label, value?, placeholder? }, danger? }) -> Promise<true | string | null> */
export function askDialog({ title, body, confirm = 'OK', cancel = 'Cancel', input = null, danger = false, focus = null }) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const field = input ? h('input.input', { type: 'text', value: input.value ?? '', placeholder: input.placeholder ?? '', 'aria-label': input.label, 'data-qa': 'dialog-input' }) : null;
    const done = (v) => { dlg.close(); dlg.remove(); opener?.focus?.(); resolve(v); };
    const ok = () => done(input ? (field.value.trim() || null) : true);
    const dlg = h('dialog.dz-dialog', { 'aria-label': title, on: { cancel: (e) => { e.preventDefault(); done(null); }, keydown: (e) => { if (e.key === 'Enter' && input) { e.preventDefault(); ok(); } } } },
      h('h2', title),
      body ? h('div.dz-dialog-body', body) : null,
      input ? h('label.dz-dialog-field', h('span.small.muted', input.label), field) : null,
      h('div.dz-dialog-actions',
        cancel ? h('button.btn', { type: 'button', 'data-qa': 'dialog-cancel', on: { click: () => done(null) } }, cancel) : null,
        h('button.btn.primary', { type: 'button', class: danger ? 'danger' : '', 'data-qa': 'dialog-ok', on: { click: ok } }, confirm)));
    document.body.append(dlg);
    dlg.showModal();
    (field ?? dlg.querySelector(focus === 'cancel' ? '[data-qa=dialog-cancel]' : '[data-qa=dialog-ok]')).focus();
  });
}
