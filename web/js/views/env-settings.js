// Environment settings (0.28.1): the subsystems of the environment (name, icon from the six, order, add, delete) and the names of the levels.
// A design environment changes subsystems through its draft: Edit with a draft, each change is one `designEdit` {kind:'subsystem'} and the page draws again.
// A sealed environment keeps them as an annotation: edit the list, one Save writes it at once. Level names are an annotation on every environment and save as you leave a field.

import { h, fill, toast } from '../dom.js';
import { api } from '../api.js';
import { state, isDesign } from '../state.js';
import { pageHead } from '../components/page.js';
import { subIcon, SS_NAMES } from '../icons.js';
import { keyFromLabel } from '../env-info.js';
import { me } from '../design/who.js';
import { afterEdit } from '../design/after-edit.js';
import { invalidateSubsystems, loadSubsystems } from '../design/subsystems-store.js';
import { editing } from '../design/edit-target.js';
import { colorSection } from './env-settings-color.js';

const plural = (n) => `${n} ${n === 1 ? 'component' : 'components'}`;

export async function render({ main, params }) {
  const env = params.name;
  const design = isDesign(env), canEdit = design ? editing() : true, subs = await loadSubsystems();
  let rows = subs.list().map((s) => ({ key: s.key, label: s.label, icon: s.icon ?? '', used: s.components.length }));
  const body = h('div.es', { 'data-qa': 'env-settings' });
  main.append(pageHead('Environment settings', env), h('div.content', body));

  /** One draft edit (design) and the page again. */
  async function edit(e) {
    try { await api.designEdit(env, state.draft, e, me()); toast(`Saved to draft ${state.draft}`); afterEdit(); } catch (err) { toast(err.message, 5000); }
  }
  async function saveSealed() {
    try { await api.putSubsystems(env, rows.map((r) => ({ key: r.key, label: r.label.trim(), ...(r.icon ? { icon: r.icon } : {}) })), me()); toast('Saved'); await refresh(); } catch (err) { toast(err.message, 5000); }
  }
  async function refresh() { state.envMeta = await api.envMeta().catch(() => state.envMeta); invalidateSubsystems(); afterEdit(); }
  const move = (i, d) => (design ? edit({ kind: 'subsystem', key: rows[i].key, order: i + d }) : (([rows[i], rows[i + d]] = [rows[i + d], rows[i]]), paint()));

  function row(r, i) {
    const name = h('input.input', { type: 'text', value: r.label, disabled: !canEdit, 'aria-label': `Name of ${r.key}`, 'data-qa': 'sub-name',
      on: { change: () => { r.label = name.value; if (design) edit({ kind: 'subsystem', key: r.key, label: name.value.trim() }); } } });
    const icons = h('div.es-icons', { role: 'radiogroup', 'aria-label': `Icon of ${r.key}` }, ['', ...SS_NAMES].map((n) => h('label', { title: n || 'No icon', class: n ? '' : 'none' },
      h('input', { type: 'radio', name: `ic-${r.key}`, value: n, checked: r.icon === n, disabled: !canEdit, 'aria-label': n || 'No icon', 'data-qa': `icon-${n || 'none'}`,
        on: { change: () => { r.icon = n; if (design) edit({ kind: 'subsystem', key: r.key, icon: n || null }); } } }), n ? subIcon(n, 16) : 'None')));
    return h('tr', { 'data-key': r.key },
      h('td', { 'data-label': 'Key' }, h('code.key', r.key)), h('td', { 'data-label': 'Name' }, name), h('td', { 'data-label': 'Icon' }, icons),
      h('td', { 'data-label': 'Order' }, h('div.es-acts', h('button.btn.sm', { type: 'button', 'aria-label': `Move ${r.label} up`, disabled: !canEdit || i === 0, on: { click: () => move(i, -1) } }, '↑'),
        h('button.btn.sm', { type: 'button', 'aria-label': `Move ${r.label} down`, disabled: !canEdit || i === rows.length - 1, on: { click: () => move(i, 1) } }, '↓'))),
      h('td', h('button.btn.sm.danger-ghost', { type: 'button', 'data-qa': 'sub-delete', disabled: !canEdit || r.used > 0, title: r.used ? `used by ${plural(r.used)}` : `Delete ${r.label}`,
        on: { click: () => (design ? edit({ kind: 'delete', anchor: `grp:${r.key}` }) : (rows.splice(i, 1), paint())) } }, r.used ? `used by ${r.used}` : 'Delete')));
  }

  function paint() {
    const key = h('input.input', { type: 'text', placeholder: 'key, e.g. platform', 'aria-label': 'New subsystem key', 'data-qa': 'new-key', disabled: !canEdit }), label = h('input.input', { type: 'text', placeholder: 'Name', 'aria-label': 'New subsystem name', 'data-qa': 'new-name', disabled: !canEdit });
    label.addEventListener('input', () => { if (!key.dataset.touched) key.value = keyFromLabel(label.value); });
    key.addEventListener('input', () => { key.dataset.touched = '1'; });
    const add = () => {
      const k = key.value.trim(), l = label.value.trim();
      if (!k || !l) { toast('A subsystem needs a key and a name.'); return; }
      if (rows.some((r) => r.key === k)) { toast(`"${k}" is already a subsystem.`); return; }
      if (design) edit({ kind: 'subsystem', key: k, label: l }); else { rows.push({ key: k, label: l, icon: '', used: 0 }); paint(); }
    };
    const levels = subs.levels, inputs = levels.map((l, i) => h('input.input', { type: 'text', value: l, 'aria-label': `Name of level ${i + 1}`, 'data-qa': 'level-name', on: { change: () => saveLevels() } }));
    async function saveLevels() {
      try { await api.putLevels(env, inputs.map((x) => x.value.trim())); toast('Level names saved'); await refresh(); } catch (err) { toast(err.message, 5000); }
    }
    fill(body,
      h('section', h('h2', 'Subsystems'),
        design && !canEdit ? h('p.es-note', { 'data-qa': 'es-readonly' }, state.draft ? 'Switch to Edit to change the subsystems.' : 'Open a draft to change the subsystems.') : null,
        design && canEdit ? h('p.es-note', `Changes go to the draft "${state.draft}" and apply with it.`) : null,
        !design ? h('p.es-note', 'This environment is sealed: names, icons and order are an annotation and save at once.') : null,
        rows.length ? h('table.es-table', h('thead', h('tr', ['Key', 'Name', 'Icon', 'Order', ''].map((t) => h('th', t)))), h('tbody', rows.map(row))) : h('p.es-note', 'No subsystems yet. Add one, or give components a groupPath.'),
        h('div.es-add', key, label, h('button.btn', { type: 'button', 'data-qa': 'add-subsystem', disabled: !canEdit, on: { click: add } }, '+ Add subsystem')),
        !design ? h('div.es-acts', h('button.btn.primary', { type: 'button', 'data-qa': 'save-subsystems', on: { click: saveSealed } }, 'Save subsystems')) : null),
      h('section', h('h2', 'Level names'), h('p.es-note', 'What the map and the filters call each level, outermost first. Saved at once, in every environment.'),
        h('div.es-levels', levels.map((_, i) => [h('label', { for: `lv-${i}` }, i === 0 ? 'Outermost' : i === levels.length - 1 ? 'Innermost' : `Level ${i + 1}`), Object.assign(inputs[i], { id: `lv-${i}` })]))),
      colorSection(env, refresh));
  }
  paint();
  return { dispose: () => {} };
}
