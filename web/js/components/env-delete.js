// "Delete environment": a confirm dialog where the user types the environment name (bug #78). Deleting is permanent, so the
// button stays disabled until the name matches. Resolves true when the environment was deleted.

import { h, toast } from '../dom.js';
import { api, deleteEnv } from '../api.js';
import { state, setEnv } from '../state.js';
import { defaultEnv, deleteConfirmed } from '../env-info.js';

export function deleteEnvDialog(name) {
  return new Promise((resolve) => {
    const opener = document.activeElement;
    const err = h('div.error-box', { role: 'alert', hidden: true });
    const field = h('input.input', { type: 'text', autocomplete: 'off', spellcheck: 'false', 'aria-label': `Type ${name} to confirm`, 'data-qa': 'dialog-input' });
    const ok = h('button.btn.primary.danger', { type: 'button', disabled: true, 'data-qa': 'dialog-ok' }, 'Delete environment');
    const done = (v) => { dlg.close(); dlg.remove(); opener?.focus?.(); resolve(v); };
    const run = async () => {
      if (!deleteConfirmed(field.value, name)) return;
      ok.disabled = true; ok.textContent = 'Deleting…';
      try {
        await deleteEnv(name);
        state.envMeta = await api.envMeta();
        state.envs = state.envMeta.map((m) => m.name);
        done(true);
        setEnv(defaultEnv(state.envs));
        toast(`Deleted ${name}`);
      } catch (e) {
        err.hidden = false; err.textContent = e.message;
        ok.textContent = 'Delete environment'; ok.disabled = !deleteConfirmed(field.value, name);
      }
    };
    field.addEventListener('input', () => { ok.disabled = !deleteConfirmed(field.value, name); });
    ok.addEventListener('click', run);
    const dlg = h('dialog.dz-dialog', { 'aria-label': `Delete environment ${name}`, on: { cancel: (e) => { e.preventDefault(); done(false); }, keydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } } } },
      h('h2', `Delete environment "${name}"?`),
      h('div.dz-dialog-body', 'This permanently removes the environment with all its components, drafts, comments and action items. It cannot be undone. You will be switched to the default environment.'),
      h('label.dz-dialog-field', h('span.small.muted', `Type ${name} to confirm`), field),
      err,
      h('div.dz-dialog-actions', h('button.btn', { type: 'button', 'data-qa': 'dialog-cancel', on: { click: () => done(false) } }, 'Cancel'), ok));
    document.body.append(dlg);
    dlg.showModal();
    field.focus();
  });
}
