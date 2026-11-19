// The Icon row of a component's Info pane (CR #144, frame 32d): the current icon and its name; in Edit with a draft a click opens the picker in place:
// a search field, the built-in set grouped (Products, AWS by category), "Custom SVG..." (paste <svg> markup or a data: URL, live preview, drawn in its own
// colours) and "None". Saving sends one component edit (`icon`, null clears) to the draft; an error (422 BAD_ICON) is shown under the picker.

import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { me } from '../design/who.js';
import { afterEdit } from '../design/after-edit.js';
import { editing } from '../design/edit-target.js';
import { compIcon } from '../components/comp-icon.js';
import { iconKind } from '../components/icon-src.js';

let rules = null; // core/component-icons.js (the same rules the server runs), loaded when a picker opens: this file stays light for the pages that only show the row

/** The name shown beside the current icon. */
export const iconName = (v) => (iconKind(v) === 'builtin' ? v : iconKind(v) ? 'Custom logo' : 'None');

/**
 * iconRow(svc, { env, name, canEdit }) -> the value cell of an "Icon" fact. `svc`: the component's header (details.icon read through `current`).
 * canEdit: a design environment of this page (the pencil is allowed). Editing also needs Edit mode with a draft; otherwise the row only shows.
 */
export function iconRow(svc, { env, name, canEdit, current }) {
  let open = false, custom = false, err = '';
  const root = h('div.ic-row', { 'data-qa': 'icon-row' });
  const kind = svc.kind ?? 'service';

  async function save(value) {
    try {
      await api.designEdit(state.env, state.draft, { kind: 'component', name, serviceKind: kind, icon: value }, me());
      toast(`Saved to draft ${state.draft}`);
      open = false; custom = false; err = '';
      afterEdit();
    } catch (e) { err = e.message ?? String(e); draw(); }
  }

  function picker() {
    const { iconProblem, searchIcons } = rules;
    const q = h('input', { type: 'search', placeholder: 'Search icons (try "queue" or "aws")', 'aria-label': 'Search icons', 'data-qa': 'icon-search' });
    const count = h('small');
    const list = h('div.ic-scr', { 'data-qa': 'icon-list' });
    const paint = () => {
      const groups = searchIcons(q.value), n = groups.reduce((t, [, items]) => t + items.length, 0);
      count.textContent = q.value.trim() ? `${n} ${n === 1 ? 'match' : 'matches'}` : '';
      list.replaceChildren(...(groups.length ? groups.flatMap(([g, items]) => [h('div.ic-gh', g),
        h('div.ic-g', items.map(([n, l]) => h('button.ic-o', { type: 'button', class: current === n ? 'on' : '', 'aria-pressed': String(current === n), 'data-icon': n, title: n, on: { click: () => save(n) } }, compIcon(n, 20), h('span.l', l))))])
        : [h('div.ic-none', 'No icon matches. Use Custom SVG... for your own.')]));
    };
    q.addEventListener('input', paint); paint();
    const x = h('div.ic-x', h('button', { type: 'button', class: custom || iconKind(current) !== 'builtin' && current ? 'on' : '', 'data-qa': 'icon-custom', on: { click: () => { custom = !custom; err = ''; draw(); } } }, 'Custom SVG...'),
      h('button', { type: 'button', class: current ? '' : 'on', 'data-qa': 'icon-none', on: { click: () => save(null) } }, 'None'));
    return h('div.ic-pick', { role: 'group', 'aria-label': 'Choose an icon' }, h('label.ic-srch', '⌕', q, count), list, x, custom ? customBox() : null, err ? h('div.ic-err', { role: 'alert', 'data-qa': 'icon-error' }, err) : null);
  }

  function customBox() {
    const { iconProblem } = rules;
    const ta = h('textarea', { 'data-qa': 'icon-svg', spellcheck: false, placeholder: '<svg viewBox="0 0 16 16" ...> or data:image/png;base64,...', 'aria-label': 'Custom SVG markup or data URL', value: iconKind(current) && iconKind(current) !== 'builtin' ? current : '' });
    const pv = h('span'), msg = h('div.ic-err', { role: 'status', 'data-qa': 'icon-problem' });
    const use = h('button.btn.primary.sm', { type: 'button', 'data-qa': 'icon-use', on: { click: () => save(ta.value.trim()) } }, 'Use this icon');
    const paint = () => {
      const v = ta.value.trim(), bad = v ? iconProblem(v) : null; // the same check the server runs
      pv.replaceChildren(v && !bad ? compIcon(v, 16) : '');
      msg.textContent = bad ?? ''; use.disabled = !v || !!bad;
    };
    ta.addEventListener('input', paint); paint();
    return h('div.ic-cust', h('div', 'Paste <svg> markup or a data: URL (at most 16 KB, no script or external links).'), ta, h('div.pv', 'Preview ', pv, ' drawn in its own colours'), msg, h('div.acts', use));
  }

  function draw() {
    const can = canEdit && editing() && env === state.env;
    const cur = h(can ? 'button.ic-cur' : 'span.ic-cur.ro', can ? { type: 'button', 'data-qa': 'icon-change', 'aria-expanded': String(open), on: { click: async () => { open = !open; err = ''; if (open) rules ??= await import('../../core/component-icons.js'); draw(); } } } : { 'data-qa': 'icon-current' },
      current ? compIcon(current, 14) : null, iconName(current), can ? h('small', open ? 'Close' : 'Change') : null);
    root.replaceChildren(...[cur, !can && canEdit ? h('small.muted', 'Switch to Edit to change the icon.') : null, can && open ? picker() : null].filter(Boolean));
  }
  draw();
  return root;
}
