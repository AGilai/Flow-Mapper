// Frame 27d: under the design strip, a banner on someone else's design. Editors (and the env's owner never) read "Open a draft to propose changes"
// with a primary Open a draft button; viewers read "read-only". Absent on your own designs and with accounts off.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { state } from '../state.js';
import { isCognito, roleIn, accessOf, isMine } from '../account.js';

/** `open`: opens the draft picker (the strip's own). null when no banner applies. */
export function accessBanner(open) {
  if (!isCognito()) return null;
  const role = roleIn(), a = accessOf();
  if (!a || isMine(a) || role === 'owner') return null;
  const how = a.visibility === 'published' && !a.member ? 'Published' : 'Shared';
  const by = a.ownerName ? ` by ${a.ownerName}` : '';
  if (role === 'editor') {
    if (state.draft) return null;
    return h('div.ac-ban', { 'data-qa': 'access-banner', 'data-role': 'editor' }, icon('lock'), h('span', h('b', `${how}${by}`), ' · read-only · Open a draft to propose changes'),
      h('button.btn.primary.sm', { type: 'button', 'data-qa': 'banner-draft', on: { click: (e) => open(e.currentTarget) } }, 'Open a draft'));
  }
  return h('div.ac-ban', { 'data-qa': 'access-banner', 'data-role': 'viewer' }, icon('lock'), h('span', h('b', `${how}${by}`), ' · read-only'));
}
