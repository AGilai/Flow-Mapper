// Editing across a reference (frame 10): when the other side of a call is a reference (`GET /call` -> targets[].reference), the form says so
// once, neutrally: the edit changes the call only, not what the component does with it. Two ways on: import its flow first, or edit the call only.
// The choice is not remembered: every open asks.

import { h } from '../../dom.js';

/** The callout text (pure). `ref` = { service, ingress, bindKey, source }. */
export const refCalloutText = (ref) => `The other side of this call is a reference: ${ref.service} · ${String(ref.bindKey).replace(/^[\w-]+:/, '')} lives in ${ref.source}. Your edit changes the call only, not what ${ref.service} does with it.`;

/** refCallout(ref, { onImport, onEditOnly }) -> node */
export function refCallout(ref, { onImport, onEditOnly }) {
  const only = h('button.btn.sm', { type: 'button', 'data-qa': 'edit-call-only', on: { click: () => { box.querySelector('.acts').hidden = true; onEditOnly(); } } }, 'Edit the call only');
  const box = h('div.stack', { 'data-qa': 'ref-callout', style: { gap: 'var(--s2)' } },
    h('div.f-callout', { role: 'note' }, h('span.dot'), h('span', refCalloutText(ref))),
    h('div.imp-acts.acts', h('button.btn.sm.primary', { type: 'button', 'data-qa': 'import-first', on: { click: onImport } }, `Import ${ref.service}'s flow first`), only));
  return box;
}
