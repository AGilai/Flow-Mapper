// Flow relations on the Flows page (0.28.2, #50), pure: the counts per flow, the list filter, the texts and the form's choices.
// A relation view (GET /flow-relations) is {id, type, from, to, note?, other, direction: 'out' | 'in', phrase}; the server writes the phrase for the end that asked.

export const REL_TYPES = ['contradicts', 'variant-of', 'supersedes', 'same-topic'];
export const TYPE_LABEL = { contradicts: 'Contradicts', 'variant-of': 'Variant of', supersedes: 'Supersedes', 'same-topic': 'Same topic' };

/** Per flow (`<service>/<ingress>`): how many relations of each type touch it. `views` = every relation of the environment. */
export function relCounts(views) {
  const m = new Map();
  for (const v of views ?? []) for (const f of [v.from, v.to]) {
    const k = `${f.service}/${f.ingress}`, c = m.get(k) ?? {};
    c[v.type] = (c[v.type] ?? 0) + 1; m.set(k, c);
  }
  return m;
}
export const relTotal = (c) => Object.values(c ?? {}).reduce((a, b) => a + b, 0);

/** The Flows list filter: null (no filter), 'any' (has a relation) or a type. Unknown values are no filter. */
export const parseRel = (param) => (param === 'any' || REL_TYPES.includes(param) ? param : null);
/** Does a flow with counts `c` pass the filter `rel`? */
export const relPasses = (c, rel) => !rel || (rel === 'any' ? relTotal(c) > 0 : (c?.[rel] ?? 0) > 0);
/** The options of the filter, with the number of flows each would show: [{ value, label, n }]. Types nobody uses are left out. */
export function relOptions(counts) {
  const flows = [...counts.values()], n = (t) => flows.filter((c) => (c[t] ?? 0) > 0).length;
  return [{ value: '', label: 'All flows', n: null }, { value: 'any', label: 'Has a relation', n: flows.length }, ...REL_TYPES.filter((t) => n(t)).map((t) => ({ value: t, label: TYPE_LABEL[t], n: n(t) }))];
}

/** "2 related flows: 1 contradicts, 1 same topic" (the badge's tooltip). */
export function relTitle(c) {
  const parts = REL_TYPES.filter((t) => c?.[t]).map((t) => `${c[t]} ${TYPE_LABEL[t].toLowerCase()}`), n = relTotal(c);
  return `${n} related flow${n === 1 ? '' : 's'}: ${parts.join(', ')}`;
}

/** What a row of "Related flows" says before the other flow's name: the phrase for this end ("supersedes", "is superseded by", "is a variant of"). */
export const phraseOf = (v) => v.phrase;

/** The six ways a flow can relate to another, as the form offers them for THIS flow: [{ value, label, type, swap }]. `swap`: this flow is the `to` end. */
export const RELATION_CHOICES = [
  { value: 'contradicts', label: 'contradicts', type: 'contradicts', swap: false },
  { value: 'variant-of', label: 'is a variant of', type: 'variant-of', swap: false },
  { value: 'has-variant', label: 'has a variant', type: 'variant-of', swap: true },
  { value: 'supersedes', label: 'supersedes', type: 'supersedes', swap: false },
  { value: 'superseded-by', label: 'is superseded by', type: 'supersedes', swap: true },
  { value: 'same-topic', label: 'same topic as', type: 'same-topic', swap: false },
];
/** The choice that reads a relation view as it is for this flow. */
export const choiceOf = (v) => RELATION_CHOICES.find((c) => c.type === v.type && c.swap === (v.direction === 'in' && !['contradicts', 'same-topic'].includes(v.type))) ?? RELATION_CHOICES[0];

/** The edit a relation form sends: `v` = { id?, here: {service, ingress}, other: {service, ingress} | null, choice: value, note }. Throws { field, message }. */
export function relationEdit(v) {
  const c = RELATION_CHOICES.find((x) => x.value === v.choice);
  if (!c) throw Object.assign(new Error('Pick how the flows relate.'), { field: 'type' });
  if (!v.other) throw Object.assign(new Error('Pick the other flow.'), { field: 'other' });
  const [from, to] = c.swap ? [v.other, v.here] : [v.here, v.other];
  return { kind: 'flow-relation', ...(v.id ? { id: v.id } : {}), from, to, type: c.type, note: (v.note ?? '').trim() };
}

/** The entry points that match a search text, for the "other flow" picker: name, component, endpoint or bind key; `here` and `taken` are left out. At most `max`. */
export function pickMatches(points, q, { here, max = 8 } = {}) {
  const t = String(q ?? '').trim().toLowerCase();
  return points.filter((p) => !(p.service === here?.service && p.id === here?.ingress) && (!t || `${p.name ?? ''} ${p.service} ${p.id} ${p.bindKey ?? ''}`.toLowerCase().includes(t))).slice(0, max);
}
