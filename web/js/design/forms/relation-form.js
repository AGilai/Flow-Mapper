// The flow relation form (0.28.2, #50): how this flow relates to another one (six phrasings from THIS flow's end: "supersedes", "is superseded by"...), the other flow
// (search the entry points by name, component, endpoint or bind key), and a note. Done sends one `designEdit` {kind:'flow-relation'} (`id` when editing; a changed type
// or end moves the relation); Delete = {kind:'delete', anchor:'rel:<id>'}. The checks are core/flow-relations.ts's; their errors show under the field.

import { api } from '../../api.js';
import { state } from '../../state.js';
import { h, fill } from '../../dom.js';
import { createFields, openForm, select, textarea, tag } from './form-kit.js';
import { RELATION_CHOICES, choiceOf, relationEdit, pickMatches } from '../../views/flow-relations-pure.js';

/** The "other flow" picker: a search box over a short list of matches; the chosen flow is shown under it. Returns { el, get() -> {service, ingress} | null, focus() }. */
function picker(points, names, here, initial) {
  const label = (p) => names.get(`${p.service}/${p.id}`) || p.name || `${p.service} · ${p.id}`;
  let chosen = initial ?? null;
  const box = h('input.input', { type: 'search', placeholder: 'Search flows', autocomplete: 'off', 'aria-label': 'Other flow: search by name, component or endpoint', 'data-qa': 'relation-search' });
  const sel = h('div.rel-chosen', { 'aria-live': 'polite', 'data-qa': 'relation-chosen' });
  const list = h('ul.rel-pick', { 'aria-label': 'Matching flows' });
  const paint = () => {
    const known = chosen && points.find((p) => p.service === chosen.service && p.id === chosen.ingress);
    fill(sel, chosen ? [h('span.xs.muted', 'Other flow: '), h('b', known ? label(known) : `${chosen.service} · ${chosen.ingress}`), known && label(known) !== `${chosen.service} · ${chosen.ingress}` ? h('span.mono.xs.muted', ` ${chosen.service} · ${chosen.ingress}`) : null] : h('span.xs.muted', 'No flow picked yet.'));
    const ms = pickMatches(points.map((p) => ({ ...p, name: label(p) })), box.value, { here, max: 8 });
    fill(list, ms.length ? ms.map((p) => h('li', h('button.rel-opt', { type: 'button', 'aria-pressed': String(chosen?.service === p.service && chosen?.ingress === p.id),
      on: { click: () => { chosen = { service: p.service, ingress: p.id }; paint(); } } }, h('b', p.name), h('span.mono.xs.muted', `${p.service} · ${p.id}`)))) : h('li.xs.muted.rel-nomatch', 'No flow matches.'));
  };
  box.addEventListener('input', paint);
  paint();
  return { el: h('div.rel-picker', box, sel, list), get: () => chosen, focus: () => box };
}

/** openRelationForm({ panel, flowsEl, here: {service, ingress}, view? }): a new relation of `here`, or `view` (a relation of `here`, as GET /flow-relations answers) edited. */
export async function openRelationForm({ panel, flowsEl, here, view = null }) {
  const [points, flowNames] = await Promise.all([api.entryPoints(state.env), api.flowNames(state.env).catch(() => [])]);
  const names = new Map(flowNames.map((n) => [`${n.service}/${n.ingress}`, n.name]));
  const fields = createFields(), choice = select(RELATION_CHOICES.map((c) => [c.value, c.label]), view ? choiceOf(view).value : 'same-topic'), note = textarea(view?.note ?? '', 3);
  const other = picker(points, names, here, view?.other ?? null);
  fields.field('type', 'This flow', choice, 'Read it as a sentence: this flow ... the other flow.');
  fields.field('other', 'Other flow', other.el);
  fields.field('note', 'Note', note, 'Why they are related (optional, up to 1000 characters).');
  const mine = names.get(`${here.service}/${here.ingress}`) || `${here.service} · ${here.ingress}`;
  openForm({ panel, flowsEl, fields, chips: [tag('flow relation')], title: view ? `Relation · ${mine}` : 'New relation', sub: `${mine}, draft ${state.draft}`,
    build: () => relationEdit({ id: view?.id, here, other: other.get(), choice: choice.value, note: note.value }),
    remove: view ? { label: 'Delete relation', title: 'Delete this relation?', body: 'Only the relation goes; both flows stay. Undo last change in Review changes brings it back until you apply.', edit: { kind: 'delete', anchor: `rel:${view.id}` } } : null });
}
