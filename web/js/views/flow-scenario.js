// The scenario of one flow tab (0.38.0, #82 part 3): the trace the server sent (every arm, internal calls only as far as they were asked for), the viewer's
// choices on it, and the view of the two (`viewOf`, the very code the server runs). Choosing an arm, opening a DB group or switching back to External needs no
// request; only "Full" and a service's "⊕ internal" fetch (once). The state object is shared with the page (flow-scenario-state.js), which writes the URL.
//
//   const sc = createScenario({ st, base, req, baseFor(req, detail, open) -> Promise<trace>, visible(key) -> bool, onChange(view) });
//   sc.view() the trace to draw; sc.choose(group, arm|'both'); sc.reset(); sc.setDetail('simple'|'external'|'full'); sc.expandHere(key) (0.44.0: unfold a repeat marker, in External); sc.toggleOpen(service); sc.toggleDb(key);
//   sc.hiddenOf(key) -> { text, show() } | null: a step the view does not show (an arm, or a detail that has not been loaded).

import { viewOf } from '../../core/trace-view.js';
import { dbRunOf } from '../../core/db-run.js';
import { toast } from '../dom.js';
import { detailSave } from './flow-prefs.js';
import { setChoice, chooseObject, applyChoose, decodeChoose, hiddenByArm, showChoices, prune, seedAll } from './flow-scenario-pure.js';

export function createScenario({ st, base: first, req, baseFor, visible = () => false, onChange = () => {}, editAll = false }) {
  let base = first, token = 0, cur = null;
  const kindOf = (t) => (t.detail === 'simple' ? 'simple' : t.detail === 'full' ? 'full' : 'external');
  const heldOf = (t) => ({ kind: kindOf(t), open: new Set(st.detail === 'external' ? st.open : []) }); // what `base` holds: the Simple view, the External one (plus the services opened), or everything (0.44.0)
  let have = heldOf(first);
  have.full = have.kind === 'full';
  const loading = new Set();
  st.edit = editAll; // edit mode of a design draft: the default of every decision is All (the URL's `ch=` is written against it)
  const decisions = () => base.decisions ?? [];
  const intra = () => base.scope === 'intra';

  const resolveCh = () => { // the link's `ch=` meets the flow's decisions: unknown groups and arms are dropped with a toast
    const r = applyChoose(decisions(), decodeChoose(st.rawCh), editAll);
    st.chosen = r.chosen; st.rawCh = null; st.resolved = true;
    if (r.dropped) toast('Part of the link\'s scenario does not apply to this flow. It was dropped.', 4500);
  };
  if (!st.resolved && kindOf(base) !== 'simple') resolveCh(); // a Simple trace carries no decisions: the link's `ch=` waits (kept as text) until External is loaded
  // Edit mode of a design draft (0.38.1): every decision not seen yet starts on All, so editing never hides a branch; leaving edit mode takes those back.
  const seed = () => { st.seeded ??= new Set(); seedAll(decisions(), st.chosen, st.seeded, editAll); };
  const sync = () => { if (kindOf(base) === 'simple') return; st.decisions = decisions(); seed(); st.chosen = prune(st.decisions, st.chosen, editAll); };
  const make = () => { sync(); cur = viewOf(base, { choose: chooseObject(st.chosen), detail: intra() ? 'full' : st.detail, open: [...st.open], dbOpen: [...st.dbOpen], group: true, unfold: [...st.unfold] }); return cur; };
  const changed = () => { make(); onChange(cur); };

  /** Fetch when the view needs more than `base` holds. Resolves false when the request failed (the caller undoes its change). */
  async function ensure() {
    const k = have.kind, need = intra() ? false : st.detail === 'simple' ? k !== 'simple' : st.detail === 'full' ? k !== 'full' : k === 'simple' || (k === 'external' && [...st.open].some((o) => !have.open.has(o)));
    if (!need) return true;
    const my = ++token;
    try {
      const t = await baseFor(req, st.detail, [...st.open]);
      if (my !== token) return false;
      base = t; have = heldOf(t); have.full = have.kind === 'full';
      if (!st.resolved && have.kind !== 'simple') resolveCh();
      return true;
    } catch (e) { if (my === token) toast(`Could not load the trace: ${e.message}`, 5000); return false; }
  }
  const api = {
    view: () => cur ?? make(), loading, decisions, isFull: () => have.full || st.detail === 'full', isSimple: () => st.detail === 'simple',
    /** "Expand here" (0.44.0): the repeat marker `key` gets the first expansion's steps under it. Simple has no such marker's steps: External is loaded and the arm that holds it chosen first. */
    async expandHere(key) {
      st.unfold.add(key);
      if (st.detail === 'simple') { await api.setDetail('external'); api.hiddenOf(key)?.show(); }
      changed();
    },
    /** The steps of the External view (the viewer's arms) that show the step `keys` (a counted Simple arrow: "Seen in External at steps 9, 23"). */
    async externalSteps(keys) {
      const want = new Set(keys), t = kindOf(base) === 'external' || kindOf(base) === 'full' ? base : await baseFor(req, 'external', []);
      return viewOf(t, { choose: chooseObject(st.chosen), detail: 'external', group: true }).messages.flatMap((m, i) => (want.has(m.key) || m.dbGroup?.members?.some((k) => want.has(k)) ? [i + 1] : []));
    },
    foldBack(key) { st.unfold.delete(key); changed(); },
    choose(group, arm) { st.chosen = setChoice(decisions(), st.chosen, group, arm, editAll); changed(); },
    reset() { st.chosen = new Map(); st.seeded?.clear(); changed(); },
    async setDetail(d) {
      if (d === st.detail) return;
      const was = st.detail;
      st.detail = d; detailSave(d); loading.add('*'); changed();
      const ok = await ensure();
      loading.delete('*');
      if (!ok) { st.detail = was; detailSave(was); }
      changed();
    },
    async toggleOpen(service) {
      if (st.detail === 'simple') { st.open.add(service); return api.setDetail('external'); } // the "N hidden" badge: External with that service opened
      if (st.open.has(service)) { st.open.delete(service); changed(); return; }
      st.open.add(service); loading.add(service); changed();
      const ok = await ensure();
      loading.delete(service);
      if (!ok) st.open.delete(service);
      changed();
    },
    /** The scenario as trace-view parameters, for the Mermaid export of what the tab shows. */
    exportView: () => ({ detail: st.detail, unfold: [...st.unfold].join(',') || null, choose: Object.entries(chooseObject(st.chosen)).map(([g, a]) => `${g}:${a}`).join(',') || null, open: [...st.open].join(',') || null, dbOpen: [...st.dbOpen].join(',') || null, group: '1' }),
    editAll: () => editAll,
    /** #86: the view with no DB runs folded: every operation is a message (the store panel lists them one by one). */
    ungrouped: () => viewOf(base, { choose: chooseObject(st.chosen), detail: intra() ? 'full' : st.detail, open: [...st.open], dbOpen: [], group: false, unfold: [] }),
    /** The run holding the message `key` (core/db-run.ts), found in the view with no run expanded: its key, members and calls; null when it is no run member. */
    runOf: (key) => dbRunOf(viewOf(base, { choose: chooseObject(st.chosen), detail: intra() ? 'full' : st.detail, open: [...st.open], dbOpen: [], group: true }).messages, key),
    toggleDb(key) { if (st.detail === 'simple') return; if (!st.dbOpen.delete(key)) st.dbOpen.add(key); changed(); },
    /** A step the view does not show: on an arm that is not in force ("Not in this scenario"), or in a detail that is not loaded ("Not in this view"); null when it is shown or gone. */
    hiddenOf(key) {
      if (visible(key)) return null;
      const arm = hiddenByArm(decisions(), st.chosen, base.messages, key);
      if (arm) { const next = showChoices(decisions(), st.chosen, arm, editAll); return { text: 'Not in this scenario', locked: !next, show: () => { if (next) { st.chosen = next; changed(); } } }; }
      if (st.detail === 'simple') return { text: 'Not in this view', show: () => api.setDetail('external') };
      if (base.messages.some((m) => m.key === key) || (!have.full && st.detail !== 'full')) return { text: 'Not in this view', show: () => api.setDetail('full') };
      return null;
    },
  };
  make();
  return api;
}
