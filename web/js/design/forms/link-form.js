// The abstract link form (0.28.1, frame 3): name, From and To (a subsystem, then optionally one of its components), mode, transport ("Not decided yet"),
// description. One `designEdit` {kind:'abstract-link'}; Delete (danger, asks first) = {kind:'delete', anchor:'link:<id>'}. A link keeps its refinement when edited.

import { h, fill } from '../../dom.js';
import { state } from '../../state.js';
import { createFields, openForm, select, input, textarea, tag } from './form-kit.js';
import { TRANSPORTS } from './endpoint-form.js';

const MODES = [['', 'Not set'], ['sync', 'sync'], ['async', 'async']];
const TRANSPORT_OPTS = [['', 'Not decided yet'], ...TRANSPORTS.filter(([t]) => t !== 'undecided')];

/** The edit a link form sends (pure): `v` = { id?, name, from: { sub, svc, keep? }, to: { sub, svc, keep? }, mode, transport, description }. `keep`: the end's own anchor when it is narrower than a component (kept as long as the component stays). */
export function linkEdit(v) {
  const name = v.name.trim();
  if (!name) throw Object.assign(new Error('Give the link a name.'), { field: 'name' });
  const end = (e, field) => {
    if (e.keep && e.svc === e.keepSvc) return e.keep;
    if (e.svc) return `svc:${e.svc}`;
    if (!e.sub) throw Object.assign(new Error('Pick a subsystem.'), { field });
    return `grp:${e.sub}`;
  };
  return { kind: 'abstract-link', ...(v.id ? { id: v.id } : {}), name, from: end(v.from, 'from'), to: end(v.to, 'to'),
    mode: v.mode || null, transport: v.transport || null, description: v.description.trim() };
}

/** One end's two selects: the subsystem, then "Whole subsystem" or one of its components. Returns { el, get() } (value read at Done). */
function endSelects(subs, end) {
  const subSel = select(subs.list().map((s) => [s.key, s.label]), end?.subsystem ?? subs.list()[0]?.key ?? ''), svcSel = select([], '');
  const paint = (value) => { const s = subs.info(subSel.value); fill(svcSel, h('option', { value: '' }, 'Whole subsystem'), (s?.components ?? []).map((c) => h('option', { value: c.name }, c.name))); svcSel.value = value ?? ''; };
  paint(end?.service);
  subSel.addEventListener('change', () => paint(''));
  return { el: h('div.f-pair', subSel, svcSel), get: () => ({ sub: subSel.value, svc: svcSel.value, keep: end && end.level === 'endpoint' ? end.anchor : null, keepSvc: end?.service ?? '' }), focus: () => subSel };
}

/** openLinkForm({ panel, subs, view?, onSaved? }): a new link, or `view` (an AbstractView) edited. */
export function openLinkForm({ panel, subs, view = null }) {
  const fields = createFields(), name = input(view?.name ?? '', { placeholder: 'usage metering' }), mode = select(MODES, view?.mode ?? ''), transport = select(TRANSPORT_OPTS, view?.transport ?? '');
  const from = endSelects(subs, view?.from), to = endSelects(subs, view?.to), desc = textarea(view?.description ?? '');
  fields.field('name', 'Name', name);
  fields.field('from', 'From', from.el, 'A subsystem, or one of its components.');
  fields.field('to', 'To', to.el);
  fields.field('mode', 'Mode', mode, 'Sync waits for the answer; async goes through a queue, topic or event.');
  fields.field('transport', 'Transport', transport);
  fields.field('description', 'Description', desc);
  openForm({ panel, flowsEl: null, fields, chips: [tag('abstract link')], title: view ? `Link · ${view.name}` : 'New abstract link', sub: `Draft ${state.draft}`,
    build: () => linkEdit({ id: view?.id, name: name.value, from: from.get(), to: to.get(), mode: mode.value, transport: transport.value, description: desc.value }),
    remove: view ? { label: 'Delete link', title: `Delete the link "${view.name}"?`, body: 'Only the link goes: a call that refined it stays. Undo last change in Review changes brings it back until you apply.', edit: { kind: 'delete', anchor: `link:${view.id}` } } : null });
}
