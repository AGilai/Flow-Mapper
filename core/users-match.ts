// Users (0.32.0, bug #66 part 2), the pure part shared by the server, the static preview and the UI: the user shape, name normalisation,
// the one matching rule (external id first, then exact name or alias, case- and space-insensitive, else nothing: the caller creates),
// the stable colour slot and initials. Spec: docs/plans/users-mentions.md.

export interface User {
  id: string; name: string; color: number; createdAt: string; lastSeenAt: string | null;
  aliases: string[]; externalIds: { source: string; externalId: string }[];
}
export const MAX_USER_NAME = 80;
export const COLOR_SLOTS = 8;

/** A name as it is compared: lower case, runs of whitespace made one space, trimmed. */
export const nameKey = (n: string) => n.replace(/\s+/g, ' ').trim().toLowerCase();

/** The colour slot (0-7) of a user id: the last hex digit modulo 8 (other characters: their char code), so it never changes on rename. */
export function colorSlot(id: string): number {
  const c = id.slice(-1), h = parseInt(c, 16);
  return (Number.isNaN(h) ? c.charCodeAt(0) : h) % COLOR_SLOTS;
}

/** Up to two letters: first letters of the first and last word, or the first two letters of a single word. */
export function initials(name: string): string {
  const w = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  if (!w.length) return '?';
  return (w.length === 1 ? [...w[0]].slice(0, 2).join('') : [...w[0]][0] + [...w[w.length - 1]][0]).toUpperCase();
}

export type MatchBy = 'external' | 'name' | 'alias';
export interface Probe { name?: string | null; source?: string | null; externalId?: string | null }

/**
 * Which live user a name or an external id points at. External id wins (it survives renames), then an exact name, then an alias that only
 * one user holds. Returns null when nothing matches or an alias is ambiguous: the caller creates a user (or, for a read, shows the name as is).
 */
export function matchUser(users: readonly User[], p: Probe): { user: User; by: MatchBy } | null {
  if (p.source && p.externalId) {
    const u = users.find((x) => x.externalIds.some((e) => e.source === p.source && e.externalId === p.externalId));
    if (u) return { user: u, by: 'external' };
  }
  const k = p.name ? nameKey(p.name) : '';
  if (!k) return null;
  const byName = users.find((x) => nameKey(x.name) === k);
  if (byName) return { user: byName, by: 'name' };
  const al = users.filter((x) => x.aliases.some((a) => nameKey(a) === k));
  return al.length === 1 ? { user: al[0], by: 'alias' } : null;
}

/** The name MCP writes under when no author is given. That user is a system user: an author and a row on the Users page, never a sign-in or "@" choice. */
export const SYSTEM_USER_NAME = 'Assistant';
export const isSystemUser = (u: { name: string }) => nameKey(u.name) === nameKey(SYSTEM_USER_NAME);
/** The users a person can sign in as or mention from the pickers (the system user left out). */
export const pickable = <T extends { name: string }>(users: readonly T[]): T[] => users.filter((u) => !isSystemUser(u));

/** Filter for pickers: every typed word must be inside the name. Recent users are the caller's order. */
export function filterUsers<T extends { name: string }>(users: readonly T[], q: string): T[] {
  const ws = nameKey(q).split(' ').filter(Boolean);
  if (!ws.length) return [...users];
  return users.filter((u) => { const k = nameKey(u.name); return ws.every((w) => k.includes(w)); });
}

const words = (n: string) => nameKey(n).replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/**
 * Do two names look like the same person ("Asaf G." and "Asaf Gilai", "Noa B." and "Noa Barak")? Same first word, and the last words share
 * their first letter (or one name is just the first word). Only a hint on the Users page: nothing merges by itself.
 */
export function looksLike(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  if (!x.length || !y.length || x[0] !== y[0] || nameKey(a) === nameKey(b)) return false;
  if (x.length === 1 || y.length === 1) return true;
  return x[x.length - 1][0] === y[y.length - 1][0];
}
/** For every user, another live user whose name looks like theirs (the first found), or nothing. */
export function lookalikes(users: readonly User[]): Map<string, User> {
  const out = new Map<string, User>();
  for (const u of users) { const o = users.find((x) => x.id !== u.id && looksLike(u.name, x.name)); if (o) out.set(u.id, o); }
  return out;
}
