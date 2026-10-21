// Which form a click opens, and the opening (0.26.0). The one switch between View and Edit: View keeps today's panels and menus.
// In Edit with a draft: a head -> the component form; an arrow -> the call form (the entry arrow -> the endpoint form); "+ call" under a bar -> the call form
// for that function; "+ component" -> the component form. Anything else (deliveries, store stubs, internal calls) keeps its read-only panel.

import { state } from '../state.js';
import { openComponentForm } from './forms/component-form.js';
import { openEndpointForm } from './forms/endpoint-form.js';
import { openCallForm } from './forms/call-form.js';
import { openDtoForm } from './forms/dto-form.js';
import { openFlowForm } from './forms/flow-form.js';

/** Is the page editing (Edit mode and a draft open)? */
export const editing = (s = state) => s.mode === 'edit' && !!s.draft;

/**
 * formFor(isEditing, target) -> 'component' | 'endpoint' | 'call' | 'flow' | null (pure).
 * target: { type: 'head', service } | { type: 'arrow', message } | { type: 'add-call' } | { type: 'add-component' } | { type: 'title', service, ingress }
 */
export function formFor(isEditing, t) {
  if (!isEditing || !t) return null;
  if (t.type === 'head') return t.service ? 'component' : null;
  if (t.type === 'add-component') return 'component';
  if (t.type === 'add-call') return 'call';
  if (t.type === 'title') return t.service && t.ingress ? 'flow' : null;
  if (t.type === 'arrow') {
    const m = t.message ?? {};
    if (m.kind === 'entry') return m.service && m.target?.ingress ? 'endpoint' : null;
    return m.kind === 'egress' && m.egress && m.service ? 'call' : null;
  }
  return null;
}

/** editOpener(host) -> the actions the flow page wires in; `host` = { panel, flowsEl, importRef }. */
export function editOpener(host) {
  const base = { panel: host.panel, flowsEl: host.flowsEl };
  const dto = (service, ingress) => (role) => openDtoForm({ ...base, service, ingress, role });
  return {
    head: (service) => openComponentForm({ ...base, service }),
    addComponent: (groupPath = '') => openComponentForm({ ...base, groupPath }),
    arrow(m) {
      const k = formFor(true, { type: 'arrow', message: m });
      if (k === 'endpoint') openEndpointForm({ ...base, service: m.service, ingress: m.target.ingress, onDto: dto(m.service, m.target.ingress) });
      else if (k === 'call') openCallForm({ ...base, from: { service: m.service, fn: '' }, egress: m.egress, operation: m.operation ?? null, onImport: host.importRef });
      return !!k;
    },
    addCall: (service, fn) => openCallForm({ ...base, from: { service, fn }, onImport: host.importRef }),
    flow: (service, ingress, name, fn) => openFlowForm({ ...base, service, ingress, name, fn }),
  };
}
