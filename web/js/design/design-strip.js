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
import { loadMarks } from './marks-store.js';
import { reviewPanel } from './draft-review.js';
import { discardDraft } from './draft-discard.js';
import { importedLine, lastImport, setLastImport } from './mermaid-undo.js';
import { isCognito, roleIn } from '../account.js';
import { visBadge } from '../components/env-badge.js';
import { accessBanner } from './access-banner.js';
import { openShare } from './share-dialog.js';
import { batchText, latestBatch } from './mermaid-pure.js';
import { designPill } from './design-pill.js';

/** Mount the strip at the top of `main`; null for a sealed environment. `host` ({ pill, mode, below }: three elements of the Flows page, frame 28): no strip, the pieces go into them instead (the pill with a menu, View | Edit, the draft bar). */
export function mountDesignStrip(main, host = null) {
  if (!isDesign()) return null;
  const meta = metaOf(state.envMeta, state.env), when = shortDate(meta.copiedAt);
  const sourceGone = !!meta.source && !state.envs.includes(meta.source);
  let review = null, drafts = [], alive = true;
  const bar = h('div.dz-draft');
  const picker = h('button.btn.dz-pick', { type: 'button', 'data-qa': 'draft-picker', 'aria-haspopup': 'menu', on: { click: (e) => openDraftPicker(e.currentTarget, { drafts }) } },
    state.draft ? 'Draft' : 'Drafts', h('span.dz-caret', '▾'));
  const role = roleIn(), viewer = isCognito() && role === 'viewer'; // accounts: a viewer reads only (no drafts, no Edit)
  const banner = accessBanner((a) => openDraftPicker(a, { edit: true, drafts }));
  const share = isCognito() && role === 'owner' ? h('button.btn.sm', { type: 'button', 'data-qa': 'share-btn', on: { click: () => openShare(state.env, () => { dispatchEvent(new HashChangeEvent('hashchange')); }) } }, 'Share') : null;
  const mode = viewer ? null : modeToggle({ onNeedDraft: (a) => openDraftPicker(a, { edit: true, drafts }) });
  let pill = null, el = null;
  if (host) { // the Flows page: the pill at the end of the tab row, View | Edit at the end of the toolbar, the draft bar under it
    pill = designPill({ meta, when, items: { share, compare: compareSwitch(meta, sourceGone), drafts: viewer ? null : picker } });
    host.pill.replaceChildren(pill.el); host.mode.replaceChildren(...(mode ? [mode] : [])); host.below.replaceChildren(...[banner, bar].filter(Boolean));
  } else el = h('div.dz', { 'data-qa': 'design-strip' },
    h('div.dz-row1',
      h('span.dz-chip', { title: `${state.env} is a design environment: a copy you can change in drafts` }, 'design'),
      isCognito() ? visBadge(meta) : null,
      share,
      h('span.mk-meta', `${meta.source ? `from ${meta.source}` : 'blank'}${when ? ', ' + when : ''}`),
      compareSwitch(meta, sourceGone),
      h('span.spacer'), viewer ? null : picker,
      mode),
    banner,
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
    if (!lastImport()) { try { const b = latestBatch((await api.draft(state.env, d.slug)).ops); if (b) setLastImport({ draft: d.slug, batch: b.batch, text: batchText(b) }); } catch { /* no undo line: the preview has no ops to read */ } }   // after a reload too: derived from the ops' origin
    if (!alive) return;
    let imported = null; // endpoints the draft imported (their behaviour came along): the delta's tooltip says so
    try { const o = Object.values((await loadMarks()).payload.refs?.origins ?? {}).filter((x) => x.inDraft); imported = o.length ? { n: o.length, from: o[0].from } : null; } catch { /* no tooltip part */ }
    const paint = (focusReview = false) => { fill(bar,
      draftBar({ draft: d, changes, review, imported, onReview: () => { if (review === 'review') close(); else { review = 'review'; paint(true); } }, onApply: () => { review = 'confirm'; paint(true); },
        onDiscard: () => discardDraft(d), onPick: (a) => openDraftPicker(a, { drafts }) }),
      importedLine({ onReview: () => { review = 'review'; paint(true); } }),
      review ? reviewPanel({ draft: d, changes: changes ?? { counts: d.counts, items: [], authors: [] }, confirm: review === 'confirm', onClose: () => close(), refresh: () => setDesign({}), names }) : null);
      if (focusReview) bar.querySelector('.dz-review')?.focus(); };
    const close = () => { review = null; paint(); bar.querySelector('[data-qa=review]')?.focus(); };
    bar.onkeydown = (e) => { if (e.key === 'Escape' && review && bar.querySelector('.dz-review')?.contains(document.activeElement)) { e.preventDefault(); close(); } };
    paint();
  }

  const notOpen = () => h('div.dz-callout', { role: 'note' }, `The draft "${state.draft}" is not open any more (applied or discarded). `,
    h('button.btn.sm', { type: 'button', on: { click: () => setDesign({ draft: null, mode: 'view' }) } }, 'Look at the environment'));

  if (el) main.prepend(el);
  restoreFocus(el ?? host.mode);
  load();
  return { dispose: () => { alive = false; pill?.close(); el?.remove(); if (host) { host.below.replaceChildren(); host.mode.replaceChildren(); } } };
}
