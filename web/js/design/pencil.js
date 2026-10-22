// The pencil (0.31.1, "Edit where you read"): one small button for every editable item, and the one step that gets from View to a form.
//   const pen = pencils({ panel, flowsEl });   // once per page
//   pen.button('endpoint', 'POST /compile', { form: 'endpoint', service, ingress })   -> a button, or null when this environment gives none
//   pen.resume();                              // last line of the page's render: finishes an Edit switch the pencil started
// Editing already (Edit + a draft): the form opens. Otherwise: one open draft is used without asking, several get a small picker, none offers
// "Start draft 'my edits'"; then the page switches to Edit, draws again, and `resume()` opens the form. Harvested environments get only the
// annotation pencils (design/pencil-pure.js).

import { h } from '../dom.js';
import { api } from '../api.js';
import { state, setDesign, isDesign } from '../state.js';
import { toast } from '../dom.js';
import { icon } from '../icons.js';
import { openMenu } from '../components/context-menu.js';
import { editing } from './edit-target.js';
import { me, deltaText } from './who.js';
import { pencilAllowed, pencilLabel, draftChoice, harvestedHint } from './pencil-pure.js';
import { openTarget } from './pencil-open.js';

let pending = null; // { target, at } : the form to open once the page has drawn itself in Edit
const LAST = 'flow-mapper.last-draft';
const lastDraft = () => { try { return localStorage.getItem(`${LAST}.${state.env}`); } catch { return null; } };
const rememberDraft = (slug) => { try { localStorage.setItem(`${LAST}.${state.env}`, slug); } catch { /* storage unavailable */ } };

/** Switch to Edit in `slug` and let the redrawn page open `target`. */
function editIn(slug, target) {
  rememberDraft(slug);
  pending = { target, at: Date.now() };
  setDesign({ draft: slug, mode: 'edit' });
}

async function startDraft(target) {
  try { const d = await api.createDraft(state.env, draftChoice([]).name, me()); editIn(d.slug, target); } catch (err) { toast(err.message); }
}

/** The click on a pencil whose page is not editing yet. */
async function chooseDraft(anchor, target) {
  if (state.draft) { editIn(state.draft, target); return; }
  let drafts;
  try { drafts = await api.drafts(state.env); } catch (err) { toast(err.message); return; }
  const c = draftChoice(drafts, lastDraft());
  if (c.kind === 'use') { editIn(c.draft.slug, target); return; }
  const r = anchor.getBoundingClientRect();
  const back = (e) => { if (e.key === 'Escape') setTimeout(() => anchor.focus()); removeEventListener('keydown', back, true); };
  addEventListener('keydown', back, true); setTimeout(() => removeEventListener('keydown', back, true), 20000);
  if (c.kind === 'start') openMenu(r.left, r.bottom + 4, 'This design has no open draft', [{ label: `Start draft “${c.name}”`, hint: 'Edits are collected in a draft you can review and apply', icon: 'plus', onSelect: () => startDraft(target) }]);
  else openMenu(r.left, r.bottom + 4, 'Edit in draft', [...c.drafts.map((d) => ({ label: `Edit in ${d.name}`, hint: deltaText(d.counts), onSelect: () => editIn(d.slug, target) })), 'divider',
    { label: 'Start another draft', icon: 'plus', onSelect: () => startDraft(target) }]);
}

/** pencils(host) -> { button(item, thing, target, extra?), note(thing, fn), about(owner, target), hint(), resume() }. host = { panel, flowsEl? }. */
export function pencils(host) {
  const design = isDesign();
  return {
    /** The pencil of `item` ('header', 'endpoint', ... see pencil-pure.js), labelled "Edit <thing>"; null where the environment gives none. `text`: a text button ("Edit") instead of the bare pencil; `glyph`: another icon (the entry-point row's flow button wears the flow icon, so it is told from the endpoint pencil). */
    button(item, thing, target, { cls = '', text = null, glyph = 'edit' } = {}) {
      if (!pencilAllowed(item, design)) return null;
      const label = pencilLabel(thing);
      return h(text ? 'button.btn' : 'button.pen', { type: 'button', class: `${editing() ? 'on ' : ''}${cls}`.trim(), 'data-qa': `pen-${item}`, 'aria-label': label, title: label, 'aria-haspopup': editing() ? null : 'menu',
        on: { click: (e) => { e.preventDefault(); e.stopPropagation(); if (editing()) openTarget(target, host); else chooseDraft(e.currentTarget, target); },
          keydown: (e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); } } }, icon(glyph), text);
    },
    /** An annotation pencil (flow and step descriptions): it does `fn` at once in every environment, no draft step. */
    note(thing, fn) {
      if (!pencilAllowed('flow-description', design)) return null;
      const label = pencilLabel(thing);
      return h('button.pen.on', { type: 'button', 'data-qa': 'pen-note', 'aria-label': label, title: label, on: { click: (e) => { e.preventDefault(); e.stopPropagation(); fn(); } } }, icon('edit'));
    },
    /** The `pen` option of aboutBlock: the title-bar pencil (whole text) and one per section, all opening `target` at the About text. Null in a harvested environment. */
    about(owner, target) {
      if (!pencilAllowed('about', design)) return null;
      const t = (section) => ({ ...target, at: 'about', section });
      return { whole: this.button('about', `${owner} About`, t(null)), empty: this.button('about', `${owner} About`, t(null), { text: 'Add about' }), section: (title) => this.button('about-section', `${owner} About section ${title}`, t(title)) };
    },
    /** The muted "Harvested — edit at the source" line of a harvested page (null in a design environment). */
    hint() {
      const t = harvestedHint(design);
      return t ? h('p.pen-hint', { 'data-qa': 'pen-hint' }, t) : null;
    },
    /** Open the form a pencil asked for, once the page is drawn in Edit. */
    resume() {
      if (!pending) return;
      const p = pending;
      pending = null;
      if (Date.now() - p.at < 8000 && editing()) setTimeout(() => openTarget(p.target, host));
    },
  };
}
