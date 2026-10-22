// The component form: name (new only: there is no rename in 2a, "delete and add"), kind, subsystem, team, description, about (0.30.2), runtime (#49), links (#54).
// One `designEdit` {kind:'component'}; an existing header keeps its other fields. Delete: "Delete <name> and its N endpoints?".

import { api } from '../../api.js';
import { state } from '../../state.js';
import { h } from '../../dom.js';
import { loadSubsystems } from '../subsystems-store.js';
import { createFields, openForm, select, input, textarea, tag } from './form-kit.js';
import { linksFields, hasLinks } from './links-fields.js';
import { aboutField } from './about-field.js';

export const KINDS = [['service', 'Service'], ['gateway', 'Gateway'], ['lambda', 'Lambda'], ['infra', 'Infra'], ['client-app', 'Client app']];
export const RUNTIMES = [['', 'Not set'], ['k8s-pod', 'Kubernetes pod'], ['k8s-deployment', 'Kubernetes deployment'], ['k8s-daemonset', 'Kubernetes daemonset'], ['k8s-operator', 'Kubernetes operator'], ['k8s-job', 'Kubernetes job']];
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** The edit a component form sends (pure): `v` = { name, serviceKind, groupPath, team, description, runtime?, links? }. */
export function componentEdit(v) {
  if (!NAME_RE.test(v.name)) throw Object.assign(new Error('Use lowercase letters, digits and "-", at most 63 characters.'), { field: 'name' });
  const e = { kind: 'component', name: v.name, serviceKind: v.serviceKind, groupPath: v.groupPath, team: v.team.trim(), description: v.description.trim() };
  if (v.about !== undefined) e.about = v.about.trim();   // '' clears it
  if (v.runtime !== undefined) e.runtime = v.runtime;
  if (v.links !== undefined) e.links = v.links;
  return e;
}

/** The sentence under the Subsystem select when an existing component's subsystem is changed (pure). */
export const movesText = (name, from, to) => `Moves ${name} from ${from} to ${to}`;

/** openComponentForm({ panel, flowsEl, service?, groupPath? }): `service` edits that component, else a new one (`groupPath` presets its subsystem). */
export async function openComponentForm({ panel, flowsEl, service = null, groupPath = '' }) {
  let head = {}, endpoints = 0;
  if (service) { const v = await api.service(state.env, service).catch(() => null); head = v?.service ?? {}; endpoints = v?.ingress?.length ?? 0; }
  const subs = await loadSubsystems(), groups = subs.list().map((g) => ({ key: g.key, label: g.label })), fields = createFields(); // the draft's own subsystems (a new one shows at once)
  const name = input(service ?? '', { placeholder: 'pop-swg', mono: true, readOnly: !!service }), kind = select(KINDS, head.kind ?? 'service');
  const was = head.groupPath ?? groupPath ?? '', sub = select([['', 'Not set'], ...groups.map((g) => [g.key, g.label]), ...(was && !groups.some((g) => g.key === was) ? [[was, was]] : [])], was);
  const moves = h('span', { 'data-qa': 'moves' }), nameOf = (k) => (k ? groups.find((g) => g.key === k)?.label ?? k : 'Not set');
  const paintMoves = () => { moves.textContent = service && sub.value !== was ? movesText(service, nameOf(was), nameOf(sub.value)) : ''; }; // a component has ONE subsystem: changing it moves it
  sub.addEventListener('change', paintMoves);
  const team = input(head.team ?? ''), desc = textarea(head.description ?? '');
  const runtime = select(RUNTIMES, head.details?.runtime ?? head.runtime ?? '');
  fields.field('name', 'Name', name, service ? 'A component keeps its name: delete it and add another to rename.' : 'Lowercase letters, digits and "-".');
  fields.field('serviceKind', 'Kind', kind);
  fields.field('groupPath', 'Subsystem', sub, moves);
  fields.field('team', 'Team', team);
  fields.field('description', 'Description', desc);
  const about = aboutField(head.about ?? '');
  fields.field('about', 'About', about.node, 'Markdown: ## headings, **bold**, - lists, [links](https://...). Shown in the component panel.');
  if (hasLinks()) fields.field('runtime', 'Runs as', runtime, 'Shows a Kubernetes mark on the component.');
  const links = linksFields(fields, head.links);
  openForm({ panel, flowsEl, fields, chips: [tag('component')], title: service ? `Component · ${service}` : 'New component',
    sub: `Draft ${state.draft}`,
    build: () => componentEdit({ name: name.value.trim(), serviceKind: kind.value, groupPath: sub.value, team: team.value, description: desc.value, about: about.value(), ...(hasLinks() ? { runtime: runtime.value, links: links.get() } : {}) }),
    remove: service ? { label: 'Delete component', title: `Delete ${service} and its ${endpoints} ${endpoints === 1 ? 'endpoint' : 'endpoints'}?`, body: 'Its functions, calls and messages go with it. Undo last change in Review changes brings it back until you apply.', edit: { kind: 'delete', anchor: `svc:${service}` } } : null });
}
