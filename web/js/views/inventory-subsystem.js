// Inventory by subsystem (0.26.0): the "All subsystems" select next to "All teams", a Subsystem column and, in design environments, rows grouped by subsystem (frame 7).
// Only services carry a `groupPath`; a chosen subsystem therefore lists its services. `subsystem=` in the URL takes one value (`-` = not set).
// A sealed environment shows the select only when a service has a groupPath.

import { h } from '../dom.js';

export const NOT_SET = '-';

/** The select's options (pure): [['', 'All subsystems'], [key, label]..., ['-', 'Not set']]; `groups` = the environment's [{key, label}], else the keys the rows use. [] = no select. */
export function subsystemOptions(items, groups = []) {
  const used = new Set(items.filter((x) => x.type === 'service').map((x) => x.groupPath ?? ''));
  const keys = groups.length ? groups.map((g) => g.key) : [...used].filter(Boolean).sort();
  if (!keys.length) return []; // a sealed environment with no groupPath at all: no select
  const label = (k) => groups.find((g) => g.key === k)?.label ?? k;
  return [['', 'All subsystems'], ...keys.map((k) => [k, label(k)]), ...(used.has('') ? [[NOT_SET, 'Not set']] : [])];
}

/** Does the row belong to the chosen subsystem ('' = any)? A nested path (`platform/identity`) belongs to `platform` too. */
export function inSubsystem(x, sel) {
  if (!sel) return true;
  if (x.type !== 'service') return false;
  const gp = x.groupPath ?? '';
  return sel === NOT_SET ? gp === '' : gp === sel || gp.startsWith(`${sel}/`);
}

/** The group header of a row (design environments): its subsystem's label, or "Not set". Null for rows that are not services. */
export const subsystemLabel = (x, groups = []) => (x.type !== 'service' ? null : x.groupPath ? groups.find((g) => g.key === x.groupPath)?.label ?? x.groupPath : 'Not set');

/** subsystemSelect(options, value, onChange) -> the <select>, or null when there is nothing to choose. */
export function subsystemSelect(options, value, onChange) {
  if (!options.length) return null;
  return h('select.select', { 'aria-label': 'Subsystem', 'data-qa': 'subsystem-select', on: { change: (e) => onChange(e.target.value) } }, options.map(([v, l]) => h('option', { value: v, selected: v === value }, l)));
}
