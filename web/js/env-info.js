// Pure helpers for how an environment is described in the rail and on the New environment page. No DOM.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 21" from an ISO timestamp (UTC); '' when it is not one. */
export function shortDate(iso) {
  const d = new Date(iso ?? '');
  return Number.isNaN(d.getTime()) ? '' : `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;

/** The small line under an environment's name: "sealed · 55 components" or "design · from prod, Oct 21". */
export function envLine(m) {
  if (!m) return '';
  if (m.kind !== 'design') return `sealed · ${plural(m.counts?.components ?? 0, 'component')}`;
  const when = shortDate(m.copiedAt);
  return `design · from ${m.source ?? '?'}${when ? ', ' + when : ''}`;
}

/** Env meta for a name; an environment the list does not know (preview data from before) reads as sealed. */
export const metaOf = (list, name) => list.find((m) => m.name === name) ?? { name, kind: 'sealed', counts: {} };

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;

/** What is wrong with the name, or '' (the server checks the same rule). */
export function nameError(name, existing) {
  if (!name) return '';
  if (!NAME_RE.test(name)) return 'Use lowercase letters, digits and "-", at most 63 characters; the name goes into links.';
  if (name === 'meta' || name === 'new') return `"${name}" is reserved.`;
  if (existing.includes(name)) return `An environment named "${name}" already exists.`;
  return '';
}

/** A subsystem key from its label: "Network (POP)" gives "network-pop". */
export const keyFromLabel = (label) => label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const sum = (rows, k) => rows.reduce((n, r) => n + (r.counts[k] ?? 0), 0);

/** The one sentence above Create. `rows` are the picked components (with `counts`), `all` the component count of the source. */
export function summarySentence({ mode, source, rows, all, groups, unassigned = 0 }) {
  if (mode === 'blank') return `Creates an empty design environment. Nothing is copied from ${source}; it is recorded as the source.`;
  if (mode === 'full') return `Copies everything in ${source}: ${plural(all, 'component')} with their functions, flows and descriptions, as of now. That revision is the baseline the New and Changed marks compare with. Bugs stay in ${source}.`;
  if (!rows.length) return 'Pick at least one component.';
  const into = groups.length === 1 ? ` into ${groups[0].key}` : groups.length > 1 ? ` into ${plural(groups.length, 'subsystem')}` : '';
  const parts = [plural(sum(rows, 'endpoints'), 'endpoint'), plural(sum(rows, 'calls'), 'call'), plural(new Set(rows.flatMap((r) => r.channelKeys ?? [])).size || sum(rows, 'channels'), 'queue and topic', 'queues and topics'), plural(sum(rows, 'stores'), 'data store'), plural(sum(rows, 'dtos'), 'DTO')];
  return `Copies ${plural(rows.length, 'component')}${into}: ${parts.join(', ')}, as of ${source} now. That revision is the baseline the New and Changed marks compare with. Their functions and flows stay in ${source}.${groups.length && unassigned ? ` ${plural(unassigned, 'picked component has', 'picked components have')} no subsystem yet.` : ''}`;
}

/** "6 endpoints · 1 data store · 9 DTOs": only what is there. */
export function carryText(c) {
  const parts = [[c.endpoints, 'endpoint'], [c.calls, 'call'], [c.channels, 'queue or topic', 'queues or topics'], [c.stores, 'data store'], [c.dtos, 'DTO']].filter(([n]) => n > 0).map(([n, a, b]) => plural(n, a, b));
  return parts.join(' · ') || 'nothing but the component';
}
