// Which form a click opens, pure (design/edit-open.js does the opening).

import { state } from '../state.js';

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
