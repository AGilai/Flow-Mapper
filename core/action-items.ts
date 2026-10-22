// Action items under a flow (0.29.0), the pure part shared by the server, the static preview and the UI: the row shapes, the statuses,
// what open and closed mean, and the field rules (description, due date). The server and the preview both validate with these.

export type ActionStatus = 'open' | 'progress' | 'done' | 'dropped';
export type ActionKind = 'created' | 'closed' | 'reopened' | 'dropped';
export const ACTION_STATUSES: readonly ActionStatus[] = ['open', 'progress', 'done', 'dropped'];
export const MAX_DESCRIPTION = 2000;

/** One item as the list returns it. */
export interface ActionItem {
  id: number; anchor: string; number: number; owner: string; description: string; status: ActionStatus; due: string | null; step: string | null;
  commentId: number | null; source: 'human' | 'ai'; createdBy: string; updatedBy: string; createdAt: string; updatedAt: string; closedAt: string | null;
}
/** A line of history. `commentId` is the comment the item was made from (null: the event is not shown in a thread). */
export interface ActionEvent { id: number; itemId: number; number: number; kind: ActionKind; actor: string; at: string; commentId: number | null }
/** `next` is the number the next item will get (never reused: deleted ones count). */
export interface ActionList { items: ActionItem[]; events: ActionEvent[]; next: number }

export const isStatus = (s: unknown): s is ActionStatus => typeof s === 'string' && (ACTION_STATUSES as readonly string[]).includes(s);
/** Open = still to do: `open` and `progress`. */
export const isOpen = (s: string) => s === 'open' || s === 'progress';
/** The event a status change writes, or null when it does not cross the open/closed line (open <-> progress, done <-> dropped). */
export function eventFor(from: string, to: string): ActionKind | null {
  if (isOpen(from) && !isOpen(to)) return to === 'dropped' ? 'dropped' : 'closed';
  if (!isOpen(from) && isOpen(to)) return 'reopened';
  return null;
}
/** `YYYY-MM-DD` that is a real calendar date. */
export const isDue = (d: unknown): d is string => {
  if (typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  const t = new Date(`${d}T00:00:00Z`);
  return !Number.isNaN(t.getTime()) && t.toISOString().slice(0, 10) === d;
};
/** Open count and total over non-deleted items. */
export const tally = (items: { status: string }[]) => ({ open: items.filter((i) => isOpen(i.status)).length, all: items.length });

export interface ItemFields { owner?: string; description?: string; status?: ActionStatus; due?: string | null }
/**
 * The field rules of a create (`partial` false: owner and description are required) or an update. Returns the cleaned fields or the message of
 * the first problem. Owner is cleaned like a comment author (1-80 characters); description is plain text, trimmed, 1-2000 characters.
 */
export function checkFields(i: any, partial: boolean, clean: (s: string) => string, maxName: number): { value: ItemFields } | { error: string } {
  const v: ItemFields = {};
  if (!partial || i?.owner !== undefined) {
    const n = typeof i?.owner === 'string' ? clean(i.owner) : '';
    if (!n) return { error: 'owner is required' };
    if (n.length > maxName) return { error: `owner is longer than ${maxName} characters` };
    v.owner = n;
  }
  if (!partial || i?.description !== undefined) {
    const d = typeof i?.description === 'string' ? i.description.trim() : '';
    if (!d) return { error: 'description is required' };
    if (d.length > MAX_DESCRIPTION) return { error: `description is longer than ${MAX_DESCRIPTION} characters` };
    v.description = d;
  }
  if (i?.status !== undefined && i.status !== null) {
    if (!isStatus(i.status)) return { error: `status must be one of ${ACTION_STATUSES.join(', ')}` };
    v.status = i.status;
  }
  if (i?.due !== undefined) {
    if (i.due !== null && !isDue(i.due)) return { error: 'due must be a date as YYYY-MM-DD' };
    v.due = i.due;
  }
  return { value: v };
}
