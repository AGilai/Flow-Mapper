// Either/or decisions in the lane (0.38.0, #82 part 3), pure. A decision is drawn where it happens, as a divider row with the arm in force (a dropdown),
// not in a bar above the flow. With "Both" chosen the arms follow one another: a divider reading "either / or", a caption per arm, and (flow-decision-draw.js)
// a thin marker per arm in the left gutter. A nested decision gets its own divider, indented, only while its parent arm is visible (the view only offers those).
// No DOM. `decisions`: the view's `decisions` ([{ group_id, name, depends_on, guard, lock, parent, chosen, arms: [{ arm, label, guard_text }] }]).

export const armRef = (d, arm) => `${d.group_id}:${arm}`;

/** How deep a decision is nested: 0 for a top-level one, 1 under an arm, ... */
export function levelOf(decisions) {
  const by = new Map(decisions.map((d) => [d.group_id, d])), memo = new Map();
  const lv = (d) => { if (!memo.has(d.group_id)) { memo.set(d.group_id, 0); const p = d.parent && by.get(d.parent.group_id); memo.set(d.group_id, p ? 1 + lv(p) : 0); } return memo.get(d.group_id); };
  return new Map(decisions.map((d) => [d.group_id, lv(d)]));
}

/**
 * decisionPlan(msgs, decisions) -> Map(position in msgs -> rows to draw before that message).
 * A row: { type: 'decision', kind: 'divider' | 'caption', decision, arm (the arm in force, or the captioned arm), both, level, k (arm ordinal, for the colour) }.
 * A decision none of whose arms has a visible message draws no row (the Scenario popover still lists it).
 */
export function decisionPlan(msgs, decisions) {
  const plan = new Map(), level = levelOf(decisions);
  const put = (i, row) => { if (!plan.has(i)) plan.set(i, []); plan.get(i).push(row); };
  const first = (d, arm) => msgs.findIndex((m) => m.arms?.includes(armRef(d, arm)));
  for (const d of decisions) {
    const chosen = d.chosen ?? d.arms[0]?.arm, lv = level.get(d.group_id) ?? 0, base = { type: 'decision', decision: d, level: lv };
    if (chosen !== 'both') {
      const i = first(d, chosen);
      if (i >= 0) put(i, { ...base, kind: 'divider', arm: chosen, both: false, k: d.arms.findIndex((a) => a.arm === chosen) });
      continue;
    }
    const at = d.arms.map((a, k) => ({ a, k, i: first(d, a.arm) })).filter((x) => x.i >= 0).sort((x, y) => x.i - y.i);
    if (!at.length) continue;
    put(at[0].i, { ...base, kind: 'divider', arm: 'both', both: true, k: -1 });
    for (const { a, k, i } of at) put(i, { ...base, kind: 'caption', arm: a.arm, both: true, k });
  }
  return plan;
}

/** The gutter markers of a drawn lane, one per captioned arm: { row0, row1 (event rows), level, k, decision, arm }. Rows are the lane's event rows. */
export function armSpans(events) {
  const out = [];
  events.forEach((e, r) => {
    if (e.type !== 'decision' || e.kind !== 'caption') return;
    const ref = armRef(e.decision, e.arm);
    let last = r;
    events.forEach((x, q) => { if (q > r && x.msg?.arms?.includes(ref)) last = q; });
    out.push({ row0: r, row1: last, level: e.level, k: e.k, decision: e.decision, arm: e.arm });
  });
  return out;
}

/** The text of a divider's "why": the lock's reason, "depends on data" and the guard (for a tooltip). */
export function guardText(d) {
  const g = d.guard;
  return [d.template_name && d.template_name !== d.name ? d.template_name : null, g?.text ? `guard: ${g.text}` : null, g?.file ? `${g.file}${g.line ? `:${g.line}` : ''}` : null].filter(Boolean).join(' · ');
}
/** "file:line" of a lock's or guard's source, or ''. */
export const srcText = (s) => (s?.file ? `${s.file}${s.line ? `:${s.line}` : ''}` : '');
