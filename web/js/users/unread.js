// How many mentions of the signed-in user are unread (0.32.0): the rail's "Mentions (n)" badge. Reloaded when someone signs in or out, when the
// window is focused again and when a page marked mentions seen (it dispatches `fm:mentions`). The UI has no push channel.

import { api } from '../api.js';
import { currentId } from './me.js';
import { watchUsers } from './directory.js';

let n = 0, seq = 0, started = false;
const subs = new Set();

export const unreadCount = () => n;
export const onUnread = (f) => { subs.add(f); return () => subs.delete(f); };
export async function refreshUnread() {
  const mine = ++seq, id = currentId();
  if (!id) { n = 0; subs.forEach((f) => f(n)); return; }
  try { const r = await api.mentions({ user: id, unread: true, limit: 1000 }); if (mine === seq) { n = r.unread; subs.forEach((f) => f(n)); } } catch { /* the badge is optional */ }
}
/** Start watching (once). */
export function startUnread() {
  if (started) return; started = true;
  watchUsers(refreshUnread);
  addEventListener('focus', refreshUnread);
  document.addEventListener('fm:mentions', refreshUnread);
  refreshUnread();
}
export const announceSeen = () => document.dispatchEvent(new CustomEvent('fm:mentions'));
