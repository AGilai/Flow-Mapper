// The users registry as the UI sees it (0.31.0): one cached list, who "me" is (a user of the list), and a way to refresh after a change.

import { api } from '../api.js';
import { currentId, onMe, setMyId } from './me.js';

let list = [], loaded = null, done = false;
const subs = new Set();
const emit = () => subs.forEach((f) => f());

/** Load (or reload with `force`) the list. */
export function loadUsers(force = false) {
  if (!loaded || force) loaded = api.users().then((r) => { list = r.users; done = true; if (currentId() && !list.some((u) => u.id === currentId())) setMyId(null); emit(); return list; }).catch((e) => { loaded = null; throw e; });
  return loaded;
}
export const users = () => list;
/** Has the list arrived (so an id that is not in it is truly unknown)? */
export const isLoaded = () => done;
export const userById = (id) => list.find((u) => u.id === id) ?? null;
/** The signed-in user, or null (nobody signed in, or the list is not loaded yet). */
export const me = () => (currentId() ? userById(currentId()) : null);
export const myName = () => me()?.name ?? '';
/** Subscribe to changes of the list or of who is signed in; returns the unsubscribe. */
export function watchUsers(f) { subs.add(f); const off = onMe(f); return () => { subs.delete(f); off(); }; }
export const signOut = () => setMyId(null);
/** Add or replace a user in the cache (after a create, rename or merge answers). */
export function remember(u) { list = [u, ...list.filter((x) => x.id !== u.id)]; emit(); }
/** Is this comment's author (or owner) the signed-in user? By id when the row has one, else by name. */
export const isMe = (id, name) => { const m = me(); return !!m && (id ? id === m.id : name === m.name); };
