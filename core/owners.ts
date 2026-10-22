// Owners of a component or a subsystem (0.33.0, info pane extra 3): a structured `owners: [userId]` next to the free-text `## Owners` section of the about.
// Stored as user ids (the registry of 0.32.0). A writer that has no ids (a harvester, a plan, an agent) sends names or { externalSource, externalId } and the
// server matches them to users (server/store/owners.ts). Pure here: the shape checks and the parsing of one entry.

export const MAX_OWNERS = 20;
/** A user id as the registry makes them (`u_` and 8 hex digits). */
export const USER_ID = /^u_[0-9a-f]{8}$/;
/** A string that reads as a user id (`u_` and no spaces, whatever follows): an owner like that is looked up as an id and never becomes a new user's name. */
export const LOOKS_LIKE_ID = /^u_\S+$/;

/** What a writer may send for one owner: a user id, a name, or an object with a name and / or an external id. */
export type OwnerEntry = string | { name?: string; externalSource?: string; externalId?: string };
export interface OwnerProbe { id?: string; name?: string; source?: string; externalId?: string }

/** The problem with a stored owners value (a list of user ids), or null. undefined and null are fine (no owners). */
export function ownersProblem(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (!Array.isArray(v)) return 'owners must be a list of user ids';
  if (v.length > MAX_OWNERS) return `owners has more than ${MAX_OWNERS} entries`;
  return v.every((x) => typeof x === 'string' && x.length > 0 && x.length <= 40) ? null : 'owners must be a list of user ids';
}

/** Stored form: trimmed, without duplicates, in the order given; `undefined` when there is nothing (so a header carries no empty list). */
export function cleanOwners(v: unknown): string[] | undefined {
  if (!Array.isArray(v)) return undefined;
  const out = [...new Set(v.filter((x): x is string => typeof x === 'string').map((x) => x.trim()).filter(Boolean))];
  return out.length ? out : undefined;
}

/** One entry of what a writer sent as a probe for the user matcher, or a problem text: a user id stays an id, a string is a name, an object is a name and / or an external id. */
export function ownerProbe(e: unknown): OwnerProbe | string {
  if (typeof e === 'string') {
    const t = e.trim();
    if (!t || t.length > 80) return 'an owner is a name of 1 to 80 characters';
    return LOOKS_LIKE_ID.test(t) ? { id: t } : { name: t };
  }
  if (e && typeof e === 'object' && !Array.isArray(e)) {
    const o = e as Record<string, unknown>, str = (k: string) => (typeof o[k] === 'string' && (o[k] as string).trim() ? (o[k] as string).trim() : undefined);
    const name = str('name'), source = str('externalSource'), externalId = str('externalId');
    if (!name && !(source && externalId)) return 'an owner needs a name, or an externalSource and an externalId';
    if ((source && !externalId) || (!source && externalId)) return 'externalSource and externalId go together';
    return { ...(name ? { name } : {}), ...(source ? { source, externalId } : {}) };
  }
  return 'an owner is a name, a user id, or { name, externalSource, externalId }';
}
