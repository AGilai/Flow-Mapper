// A user's face (0.32.0, frame 18): initials on a tint of one of the eight component tones, picked from the id (stable across renames).

import { h } from '../dom.js';
import { initials, colorSlot } from '../../core/users-match.js';

/** userAvatar(user | { name, id? }, size?) with size '' | 's' | 'l'. A name with no id gets the neutral tone. */
export function userAvatar(u, size = '') {
  const name = u?.name ?? '';
  const slot = u?.id ? (u.color ?? colorSlot(u.id)) : null;
  return h(`span.u-av${size ? '.' + size : ''}`, { 'aria-hidden': 'true', title: name, style: slot == null ? null : `--c:var(--cmp-${slot + 1})` }, initials(name));
}
