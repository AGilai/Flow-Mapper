// The scenario of a flow tab (0.38.0, #82 part 3), pure: which arm of each either/or decision is in force, how that goes into the URL (`ch=`),
// what differs from the defaults, and where a step that the scenario hides lives (so "Show" can bring it back). No DOM, no core/ imports.
//
//   decisions: the offered decisions of the trace fetched with every arm (`choose=*:both`): [{ group_id, name, parent?: { group_id, arm }, lock?: { arm }, arms: [{ arm, label }] }]
//   chosen:    Map group_id -> arm | 'both', ONLY the choices that differ from the default (the first arm). A lock is data, never a choice, never in the URL.

/** Prefix of a group id used in the URL: the first 8 characters, longer when two ids of this flow would clash. */
const flat = (id) => id.replace(/[:,%]/g, '_'); // 0.38.2: an alt group id is `<fn>:<altGroup>`: the URL prefix never holds the separators
export function shortIds(decisions) {
  const out = new Map();
  for (const d of decisions) {
    let n = 8;
    const id = flat(d.group_id);
    while (n < id.length && decisions.some((o) => o !== d && flat(o.group_id).slice(0, n) === id.slice(0, n))) n++;
    out.set(d.group_id, id.slice(0, n));
  }
  return out;
}

/** The arm in force for a decision: its lock, else the choice, else the first arm. */
export const armIn = (d, chosen) => d.lock?.arm ?? chosen.get(d.group_id) ?? d.arms[0]?.arm;
export const isBoth = (d, chosen) => !d.lock && chosen.get(d.group_id) === 'both';

/** The decisions a viewer can see now: a nested one only while its parent decision is offered and its parent arm is in force (or both). */
export function offeredSet(decisions, chosen) {
  const by = new Map(decisions.map((d) => [d.group_id, d])), memo = new Map();
  const ok = (d) => {
    if (!memo.has(d.group_id)) {
      const p = d.parent && by.get(d.parent.group_id);
      memo.set(d.group_id, !p || (ok(p) && (armIn(p, chosen) === d.parent.arm || armIn(p, chosen) === 'both')));
    }
    return memo.get(d.group_id);
  };
  return new Set(decisions.filter(ok).map((d) => d.group_id));
}

/** The choices that remain once everything that is the default, locked, unknown or not offered is dropped (a nested choice is forgotten with its parent arm). */
export function prune(decisions, chosen, edit = false) { // `edit`: edit mode of a design draft, where every decision starts on All: the explicit choices stay, the first arm too (it is not the default there)
  let cur = new Map(chosen);
  for (let pass = 0; pass < 6; pass++) { // a nested choice depends on its parent's, so repeat until it settles
    const off = offeredSet(decisions, cur), next = new Map();
    for (const d of decisions) {
      const a = cur.get(d.group_id);
      if (a && !d.lock && off.has(d.group_id) && (edit || a !== d.arms[0]?.arm) && (a === 'both' || d.arms.some((x) => x.arm === a))) next.set(d.group_id, a);
    }
    if (next.size === cur.size && [...next].every(([k, v]) => cur.get(k) === v)) return next;
    cur = next;
  }
  return cur;
}

/** The new choices after the viewer picked `arm` of `group` (`arm` may be 'both'). */
export function setChoice(decisions, chosen, group, arm, edit = false) {
  const next = new Map(chosen);
  next.set(group, arm);
  return prune(decisions, next, edit);
}

/** Edit mode of a design draft: every decision not seen yet (`seeded`) starts on All unless it is locked or already chosen, so editing never hides a branch.
 *  Off edit mode the seeded ones that still say All go back to the default. Mutates `chosen` and `seeded`. */
export function seedAll(decisions, chosen, seeded, on) {
  if (on) { for (const d of decisions) if (!d.lock && !seeded.has(d.group_id)) { seeded.add(d.group_id); if (!chosen.has(d.group_id)) chosen.set(d.group_id, 'both'); } }
  else if (seeded.size) { for (const g of seeded) if (chosen.get(g) === 'both') chosen.delete(g); seeded.clear(); }
}

/** How many decisions differ from the defaults. */
export const changedCount = (decisions, chosen, edit = false) => [...prune(decisions, chosen, edit).values()].filter((a) => !edit || a !== 'both').length; // edit mode: All is the default

/** `ch=` : `<id8>:<arm>,...` for the choices that differ from the default, else null. Arm names are percent-encoded (`,` and `:` are the separators). */
export function encodeChoose(decisions, chosen, edit = false) {
  const ids = shortIds(decisions), c = new Map([...prune(decisions, chosen, edit)].filter(([, a]) => !edit || a !== 'both')); // edit mode: All is the default, not written
  const list = decisions.filter((d) => c.has(d.group_id)).map((d) => `${ids.get(d.group_id)}:${encodeURIComponent(c.get(d.group_id))}`);
  return list.length ? list.join(',') : null;
}

/** `ch=` text -> [{ id8, arm }] (malformed entries are skipped). */
export function decodeChoose(text) {
  if (!text) return [];
  return String(text).split(',').flatMap((e) => {
    const i = e.indexOf(':');
    if (i < 1 || i === e.length - 1) return [];
    try { return [{ id8: e.slice(0, i), arm: decodeURIComponent(e.slice(i + 1)) }]; } catch { return []; }
  });
}

/** Decoded `ch=` against the flow's decisions -> { chosen (valid, differing ones), dropped (entries that matched no decision or arm) }. */
export function applyChoose(decisions, decoded, edit = false) {
  const raw = new Map();
  let dropped = 0;
  for (const { id8, arm } of decoded) {
    const d = decisions.find((x) => flat(x.group_id).startsWith(id8)), ok = d && (arm === 'both' || d.arms.some((a) => a.arm === arm));
    if (ok) raw.set(d.group_id, arm); else dropped++;
  }
  return { chosen: prune(decisions, raw, edit), dropped };
}

/** The `choose` object of the request / of `viewOf` (explicit choices only; the rest follows the first arm). */
export const chooseObject = (chosen) => Object.fromEntries(chosen);

/** Everything the page puts in the URL for a tab's scenario: { ch, detail, open } (null = no param). */
export const scenarioQuery = (decisions, s) => ({ ch: encodeChoose(decisions, s.chosen, !!s.edit), detail: s.detail === 'full' ? 'full' : null, open: s.open.size && s.detail !== 'full' ? [...s.open].join(',') : null }); // Full has everything loaded: no `open=`

/** `ch`, `detail`, `open` of a URL query (URLSearchParams) -> { decoded, detail, open: Set }. */
export function readQuery(query) {
  const d = query.get('detail');
  return { decoded: decodeChoose(query.get('ch')), detail: d === 'full' || d === 'external' ? d : null, open: new Set((query.get('open') ?? '').split(',').map((x) => x.trim()).filter(Boolean)) };
}

/** "6 steps", "6–7 steps" from `counts.messages` ({min, max}); `per`: the range reads "per path". */
export function stepsText(counts, per = false) {
  const c = counts?.messages ?? counts;
  if (!c || c.min == null) return '';
  const n = c.min === c.max ? `${c.min}` : `${c.min}–${c.max}`;
  const range = c.min !== c.max; // a range counts messages (the paths differ in length); an exact count is the lane's steps, as the step bar counts them
  return `${n} ${range ? 'messages' : c.max === 1 ? 'step' : 'steps'}${range && per ? ' per path' : ''}`;
}

/**
 * Where a step that the current view does not show lives: `canon` the messages of the fetched trace (every arm; each carries `key` and `arms`),
 * `visible` Set of the keys the view shows (a DB group counts all its members). -> null when the step is shown (or unknown here),
 * `{ path: [[group, arm], ...] }` when an arm hides it (outermost first).
 */
export function hiddenByArm(decisions, chosen, canon, key) {
  const m = canon.find((x) => x.key === key);
  if (!m) return null;
  const path = (m.arms ?? []).map((e) => { const i = /:(?:b\d+|both)$/.test(e) ? e.lastIndexOf(':') : e.indexOf(':'); return [e.slice(0, i), e.slice(i + 1)]; });
  const by = new Map(decisions.map((d) => [d.group_id, d]));
  const off = path.filter(([g, a]) => { const d = by.get(g); const cur = d && armIn(d, chosen); return d && cur !== 'both' && cur !== a; });
  return off.length ? { path, locked: off.some(([g]) => by.get(g).lock) } : null;
}

/** "Show" for a step on a hidden arm: the choices that put every group on its path on the step's arm (null: a lock forbids it). */
export function showChoices(decisions, chosen, hidden, edit = false) {
  if (!hidden || hidden.locked) return null;
  let next = new Map(chosen);
  for (const [g, a] of hidden.path) next.set(g, a);
  return prune(decisions, next, edit);
}

/** The key of a step -> the visible step that stands for it (a collapsed DB group stands for its members). */
export const stepOfKey = (steps, key) => steps.find((s) => s.key === key || s.keys?.includes(key)) ?? null;

/** The tooltip of the Flows list chip "N decisions": the default view's steps (External, first arms), the range with Both, the Full count. */
export function decisionsTitle(c) {
  const n = c.decisions, both = c.both && c.both.min !== c.both.max ? `${c.both.min}–${c.both.max}` : `${c.both?.min ?? c.steps}`;
  return `${n} either / or ${n === 1 ? 'decision' : 'decisions'} in this flow. The list counts the default view: ${c.steps} steps (External, first arm of each). With Both: ${both} messages per path. Full: ${c.full} steps.`;
}
