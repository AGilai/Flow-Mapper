// The subsystem form (0.30.2): the name and the About text of one subsystem, one `designEdit` {kind:'subsystem'}. Order, icon and the
// list are still edited in the environment's settings page.

import { state } from '../../state.js';
import { createFields, openForm, input, tag } from './form-kit.js';
import { aboutField } from './about-field.js';

/** The edit the form sends (pure). `about: ''` clears the text. */
export const subsystemEdit = (v) => ({ kind: 'subsystem', key: v.key, ...(v.label?.trim() ? { label: v.label.trim() } : {}), about: v.about.trim() });

/** openSubsystemForm({ panel, flowsEl?, box }): `box` = the subsystem as the map returns it ({ key, label, about? }). */
export function openSubsystemForm({ panel, flowsEl = null, box }) {
  const fields = createFields(), label = input(box.label), about = aboutField(box.about ?? '');
  fields.field('label', 'Name', label);
  fields.field('about', 'About', about.node, 'Markdown: ## headings, **bold**, - lists, [links](https://...). Shown in the subsystem panel.');
  openForm({ panel, flowsEl, fields, chips: [tag('subsystem')], title: `Subsystem · ${box.label}`, sub: `Draft ${state.draft}`,
    build: () => subsystemEdit({ key: box.key, label: label.value, about: about.value() }) });
}
