// The visibility badge of an environment (frame 27): Private (lock), Shared · N (people), Published (globe), Sealed (shield). Neutral outlined pills:
// the icon and the word carry the meaning, never a status colour (UI-GUIDE 8).

import { h } from '../dom.js';
import { icon } from '../icons.js';

/** badge(meta): null when the server has no accounts (no `access` on the meta). */
export function visBadge(meta) {
  const a = meta?.access;
  if (!a) return null;
  const sealed = meta.kind !== 'design';
  const [ic, text, tip] = sealed ? ['shield', 'Sealed', 'Harvested: read-only for everyone, only harvesters write it']
    : a.visibility === 'published' ? ['globe', 'Published', 'Everyone who signs in can open it read-only']
    : a.visibility === 'shared' ? ['people', `Shared · ${a.memberCount}`, 'Shared with the people listed in Share']
    : ['lock', 'Private', 'Only its owner (and admins) can open it'];
  return h('span.ac-vb', { class: a.visibility === 'published' && !sealed ? 'pub' : '', 'data-qa': 'vis-badge', title: tip }, icon(ic), text);
}
