// The strip above every page of a design environment: what the environment is (design, from <source>), what marks compare with,
// the draft picker, the View · Edit toggle, and, when a draft is open, the draft bar and its review panel. Sealed environments get none.

import { h, fill } from '../dom.js';
import { api } from '../api.js';
import { state, isDesign, setDesign } from '../state.js';
import { metaOf, shortDate } from '../env-info.js';
import { modeToggle, restoreFocus } from './mode-toggle.js';
import { compareSwitch } from './compare-switch.js';
import { openDraftPicker } from './draft-picker.js';
import { draftBar } from './draft-bar.js';
import { reviewPanel } from './draft-review.js';
import { discardDraft } from './draft-discard.js';

/** Mount the strip at the top of `main`; null for a sealed environment. */
export function mountDesignStrip(main) {
  if (!isDesign()) return null;
  const meta = metaOf(state.envMeta, state.env), when = shortDate(meta.copiedAt);
  const sourceGone = !!meta.source && !state.envs.includes(meta.source);
  let review = null, drafts = [], alive = true;
  const bar = h('div.dz-draft');
  const picker = h('button.btn.dz-pick', { type: 'button', 'data-qa': 'draft-picker', 'aria-haspopup': 'menu', on: { click: (e) => openDraftPicker(e.currentTarget, { drafts }) } },
    state.draft ? 'Draft' : 'Drafts', h('span.dz-caret', '▾'));
  const el = h('div.dz', { 'data-qa': 'design-strip' },
    h('div.dz-row1',
      h('span.dz-chip', { title: `${state.env} is a design environment: a copy you can change in drafts` }, 'design'),
      h('span.mk-meta', `from ${meta.source ?? '?'}${when ? ', ' + when : ''}`),
      compareSwitch(meta, sourceGone),
      h('span.spacer'), picker,
      modeToggle({ onNeedDraft: (a) => openDraftPicker(a, { edit: true, drafts }) })),
    bar);

  async function load() {
    try { drafts = await api.drafts(state.env); } catch { drafts = []; }
    if (!alive) return;
    const d = state.draft && drafts.find((x) => x.slug === state.draft);
    if (state.draft && !d) { fill(bar, notOpen()); return; }
    if (!d) { fill(bar, state.mode === 'edit' ? h('div.dz-hint', 'Edit works inside a draft. ', h('button.btn.sm', { type: 'button', on: { click: (e) => openDraftPicker(e.currentTarget, { edit: true, drafts }) } }, 'Pick or start a draft')) : null); return; }
    let changes = null, names = new Map();
    try { changes = await api.draftChanges(state.env, d.slug); } catch { /* the bar falls back to the draft's own counts */ }
    try { names = new Map((await api.flowNames(state.env)).filter((n) => n.name).map((n) => [`${n.service}/${n.ingress}`, n.name])); } catch { /* rows read the entry id */ }
    if (!alive) return;
    const paint = (focusReview = false) => { fill(bar,
      draftBar({ draft: d, changes, review, onReview: () => { if (review === 'review') close(); else { review = 'review'; paint(true); } }, onApply: () => { review = 'confirm'; paint(true); },
        onDiscard: () => discardDraft(d), onPick: (a) => openDraftPicker(a, { drafts }) }),
      review ? reviewPanel({ draft: d, changes: changes ?? { counts: d.counts, items: [], authors: [] }, confirm: review === 'confirm', onClose: () => close(), refresh: () => setDesign({}), names }) : null);
      if (focusReview) bar.querySelector('.dz-review')?.focus(); };
    const close = () => { review = null; paint(); bar.querySelector('[data-qa=review]')?.focus(); };
    bar.onkeydown = (e) => { if (e.key === 'Escape' && review && bar.querySelector('.dz-review')?.contains(document.activeElement)) { e.preventDefault(); close(); } };
    paint();
  }

  const notOpen = () => h('div.dz-callout', { role: 'note' }, `The draft "${state.draft}" is not open any more (applied or discarded). `,
    h('button.btn.sm', { type: 'button', on: { click: () => setDesign({ draft: null, mode: 'view' }) } }, 'Look at the environment'));

  main.prepend(el);
  restoreFocus(el);
  load();
  return { dispose: () => { alive = false; el.remove(); } };
}
