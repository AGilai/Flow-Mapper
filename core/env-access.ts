// Who may do what with an environment and its drafts (AWS v1 part C, docs/plans/aws-v1.md section 3). Pure: the server loads the rows (server/access.ts).
// (core/access.ts already exists: the read/write access of data-store steps, so these rules live here.)
// Roles: owner (share, publish, delete), editor (open and apply drafts, annotate), viewer (read), none (the env does not exist for that person).
// Sealed (harvested) envs: everyone signed in reads; an admin manages. Design envs: the owner, the listed members, everyone when published.
// A design without an owner (every design from before 0.52.0) is published and managed by admins only, until an admin gives it an owner.

export type Role = 'none' | 'viewer' | 'editor' | 'owner';
export type Visibility = 'private' | 'shared' | 'published';
export type MemberRole = 'viewer' | 'editor';
export interface EnvAcl { kind: 'sealed' | 'design'; ownerId: string | null; visibility: Visibility; members: Record<string, MemberRole> }
/** The signed-in person (`id` null: nobody, or a token whose user is unknown). */
export interface Who { id: string | null; admin: boolean }
export interface DraftAcl { ownerId: string | null; visibility: 'private' | 'shared' }

const RANK: Record<Role, number> = { none: 0, viewer: 1, editor: 2, owner: 3 };
export const atLeast = (r: Role, need: Role) => RANK[r] >= RANK[need];

export function roleOf(a: EnvAcl, who: Who): Role {
  if (who.admin) return 'owner';
  if (!who.id) return 'none';
  if (a.kind === 'sealed') return 'viewer';
  if (a.ownerId && a.ownerId === who.id) return 'owner';
  const m = a.members[who.id];
  if (m) return m;
  return a.visibility === 'published' ? 'viewer' : 'none';
}

/** The badge: Private (no one else), Shared (people listed) or Published (everyone reads). */
export function visibilityOf(published: boolean, memberCount: number): Visibility {
  return published ? 'published' : memberCount > 0 ? 'shared' : 'private';
}

/** A draft is read by its author, an admin, and (once shared) everyone who reads the env; edited by its author, an admin, and (once shared) the env's editors. */
export function draftRole(env: Role, d: DraftAcl, who: Who): 'none' | 'viewer' | 'editor' | 'author' {
  if (who.admin || (who.id && d.ownerId === who.id)) return 'author';
  if (env === 'none' || !who.id) return 'none';
  if (d.visibility !== 'shared') return 'none';
  return atLeast(env, 'editor') ? 'editor' : 'viewer';
}
export const canReadDraft = (env: Role, d: DraftAcl, who: Who) => draftRole(env, d, who) !== 'none';
export const canEditDraft = (env: Role, d: DraftAcl, who: Who) => { const r = draftRole(env, d, who); return (r === 'author' || r === 'editor') && atLeast(env, 'editor'); };
/** Apply needs editor rights on the env (and the right to edit the draft). */
export const canApplyDraft = canEditDraft;
/** Discard: the draft's author, the env's owner or an admin. Sharing a draft: its author or an admin. */
export const canDiscardDraft = (env: Role, d: DraftAcl, who: Who) => who.admin || (!!who.id && d.ownerId === who.id) || (env === 'owner' && draftRole(env, d, who) !== 'none');
export const canShareDraft = (d: DraftAcl, who: Who) => who.admin || (!!who.id && d.ownerId === who.id);
