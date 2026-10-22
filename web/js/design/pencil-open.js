// What a pencil opens (0.31.1): the same forms the diagram uses (design/edit-open.js), chosen by the pencil's target, plus the landing spot
// inside the form (an About section, the links). A target is { form: 'component' | 'subsystem' | 'endpoint' | 'flow', ...its arguments, at? }.

import { openComponentForm } from './forms/component-form.js';
import { openSubsystemForm } from './forms/subsystem-form.js';
import { openEndpointForm } from './forms/endpoint-form.js';
import { openFlowForm } from './forms/flow-form.js';
import { openDtoForm } from './forms/dto-form.js';
import { sectionOffset } from './pencil-pure.js';

/** Wait (up to ~1.5 s) for `find()` to return something, then give it to `done`. The forms load their data before they draw. */
function when(find, done) {
  let n = 0;
  const tick = () => { const x = find(); if (x) done(x); else if (++n < 30) setTimeout(tick, 50); };
  tick();
}

/** Put the cursor of the About text on the `## title` line (or at the top for the whole text) and scroll it into view. */
export function landOnAbout(title = null) {
  when(() => document.querySelector('[data-qa=about-text]'), (ta) => {
    const off = title ? Math.max(0, sectionOffset(ta.value, title)) : 0;
    const line = ta.value.slice(0, off).split('\n').length - 1, lh = parseFloat(getComputedStyle(ta).lineHeight) || 16;
    ta.scrollIntoView?.({ block: 'nearest' });
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(off, off);
    ta.scrollTop = Math.max(0, line * lh - lh);
  });
}

/** Focus the first links field of the open form. */
const landOnLinks = () => when(() => document.getElementById('f-links.main')?.querySelector('input'), (el) => el.focus());

/** openTarget(target, host) -> opens the form; `host` = { panel, flowsEl? } of the page. */
export function openTarget(t, host) {
  const base = { panel: host.panel, flowsEl: host.flowsEl ?? null };
  if (t.form === 'component') {
    const p = openComponentForm({ ...base, service: t.service });
    if (t.at === 'about') p.then(() => landOnAbout(t.section ?? null)); else if (t.at === 'links') p.then(landOnLinks);
  } else if (t.form === 'subsystem') {
    openSubsystemForm({ ...base, box: t.box });
    if (t.at === 'about') landOnAbout(t.section ?? null);
  } else if (t.form === 'endpoint') {
    openEndpointForm({ ...base, service: t.service, ingress: t.ingress, onDto: (role) => openDtoForm({ ...base, service: t.service, ingress: t.ingress, role }) });
  } else if (t.form === 'flow') {
    openFlowForm({ ...base, service: t.service, ingress: t.ingress, name: t.name ?? '' });
  }
}
