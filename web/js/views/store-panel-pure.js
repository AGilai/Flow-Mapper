// #86 store panel, the small rules of the interaction (no DOM, so tests can import them): which head is pressed, what a press does, how the diagram scrolls to a step.

/** Is the lifeline column `c` the store the panel is on? `active`: { group, collection } | null (collection null: every collection of the group, as the folded lifeline). */
export function pressed(c, active) {
  if (!active || !c || c.kind !== 'resource' || c.group !== active.group) return false;
  return !active.collection || c.collection === active.collection || !!c.stack;
}
/** A column is a store head the panel opens from: a Redis or Mongo lifeline. */
export const isStoreHead = (c) => !!c && c.kind === 'resource' && (c.storeKind === 'redis' || c.storeKind === 'mongodb');
/** The target a head stands for: a folded lifeline (`stack`) is the whole group, a Mongo lifeline its collection, a Redis lifeline the whole instance. */
export const targetOfHead = (c) => ({ group: c.group, collection: c.stack || c.storeKind !== 'mongodb' ? null : c.collection ?? null });

/** What a press on a head does: open the panel on its store, or close it when that store's panel is the open one. */
export const press = (active, target) => (active && active.group === target.group && (active.collection ?? null) === (target.collection ?? null) ? { close: true } : { open: target });

/** How the diagram moves to a step's row: 'nearest' when it is in view (it still reveals a part cut at an edge), 'center' when it is off screen. Rects: { top, bottom }. */
export function scrollPlan(row, view) {
  if (!row || !view) return 'nearest';
  return row.bottom < view.top || row.top > view.bottom ? 'center' : 'nearest';
}
/** How long the row flashes after a chip: 1.5 s, or (reduced motion) null: a static outline that stays until the next chip or Esc. */
export const flashMs = (reduced) => (reduced ? null : 1500);

/** The tooltip and accessible name of a store head. */
export const HEAD_TIP = 'Show what this flow touches in this store';
export const headLabel = (c) => `Show what this flow touches in ${c.storeKind === 'redis' ? c.store : c.label}, ${c.storeKind}`;
