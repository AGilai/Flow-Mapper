// The Type row of a component's Info pane (frame 34, 0.68.0): "IDP · Auth0" (generic, then specific, with the small logo), "IDP" (generic only), "Service" (none or unknown).
// In Edit with a draft a click opens a two-step picker in place: the generic types first (with a search that also finds specific types), then the specific types of the chosen
// generic one, or "Generic only". "None" clears the type. Saving sends one component edit (`type`, null clears) to the draft; an error (422 BAD_TYPE) is shown under the picker.

import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { me } from '../design/who.js';
import { afterEdit } from '../design/after-edit.js';
import { editing } from '../design/edit-target.js';
import { compIcon } from '../components/comp-icon.js';
import { searchTypes, specificsOf, typeInfo, typeLabel } from '../components/type-info.js';
import { typeParts } from './pane-type.js';

/** The value cell of a "Type" fact: the current type as text with its logo; the pencil picker in Edit. `canEdit`: a design environment of this page. */
export function typeRow(svc, { env, name, canEdit }) {
  let open = false, generic = null, err = '';
  const root = h('div.ic-row', { 'data-qa': 'type-row' });
  const kind = svc.kind ?? 'service', p = typeParts(svc);

  async function save(value) {
    try {
      await api.designEdit(state.env, state.draft, { kind: 'component', name, serviceKind: kind, type: value }, me());
      toast(`Saved to draft ${state.draft}`);
      open = false; generic = null; err = '';
      afterEdit();
    } catch (e) { err = e.message ?? String(e); draw(); }
  }

  const tile = (t, label, on, click, qa) => h('button.ic-o', { type: 'button', class: on ? 'on' : '', 'aria-pressed': String(on), 'data-type': qa ?? t.id, title: t.id, on: { click } }, compIcon(t.id, 20), h('span.l', label));

  function picker() {
    const q = h('input', { type: 'search', placeholder: 'Search types (try "queue" or "aws")', 'aria-label': 'Search types', 'data-qa': 'type-search' });
    const count = h('small'), list = h('div.ic-scr', { 'data-qa': 'type-list' });
    const paint = () => {
      if (generic && !q.value.trim()) {
        const g = typeInfo(generic);
        list.replaceChildren(h('div.ic-gh', h('button.ic-back', { type: 'button', 'data-qa': 'type-back', on: { click: () => { generic = null; paint(); } } }, '‹ Back'), ` ${g.label}`),
          h('div.ic-g.c3', tile(g, 'Generic only', p.id === g.id, () => save(g.id), 'generic-only'), specificsOf(generic).map((t) => tile(t, t.label, p.id === t.id, () => save(t.id)))));
        count.textContent = '';
        return;
      }
      const hit = searchTypes(q.value), words = !!q.value.trim(), n = hit.generic.length + (words ? hit.specific.length : 0);
      count.textContent = words ? `${n} ${n === 1 ? 'match' : 'matches'}` : '';
      list.replaceChildren(...(n ? [...(hit.generic.length ? [h('div.ic-gh', words ? 'Types' : 'What is it?'), h('div.ic-g', hit.generic.map((t) => tile(t, t.label, p.generic === t.id && p.id === t.id, () => { generic = t.id; q.value = ''; paint(); })))] : []),
        ...(words && hit.specific.length ? [h('div.ic-gh', 'Specific'), h('div.ic-g.c3', hit.specific.map((t) => tile(t, t.label, p.id === t.id, () => save(t.id))))] : [])] : [h('div.ic-none', 'No type matches.')]));
    };
    q.addEventListener('input', paint); paint();
    const x = h('div.ic-x', h('button', { type: 'button', class: svc.type ? '' : 'on', 'data-qa': 'type-none', on: { click: () => save(null) } }, 'None (service)'));
    return h('div.ic-pick', { role: 'group', 'aria-label': 'Choose a type' }, h('label.ic-srch', '⌕', q, count), list, x, err ? h('div.ic-err', { role: 'alert', 'data-qa': 'type-error' }, err) : null);
  }

  const current = () => p.specific ? [h('b', p.genericLabel), h('span.ty-sep', '·'), compIcon(p.id, 16), p.specific] : [compIcon(p.id, 16), h('b', p.genericLabel)];
  function draw() {
    const can = canEdit && editing() && env === state.env;
    const cur = h(can ? 'button.ic-cur' : 'span.ic-cur.ro', can ? { type: 'button', 'data-qa': 'type-change', 'aria-expanded': String(open), on: { click: () => { open = !open; err = ''; generic = null; draw(); } } } : { 'data-qa': 'type-current' },
      ...current(), can ? h('small', open ? 'Close' : 'Change') : null);
    root.replaceChildren(...[cur, p.unknown ? h('small.muted', { 'data-qa': 'type-unknown' }, `The manifest says "type": "${p.unknown}": not a known type, read as ${typeLabel(p.id).toLowerCase()}.`) : null,
      !can && canEdit ? h('small.muted', 'Switch to Edit to change the type.') : null, can && open ? picker() : null].filter(Boolean));
  }
  draw();
  return root;
}
