// Editing the About inside the pane (0.33.0, frame 19d): in Edit with a draft open, the About pencils of the pane open this editor in place of the pane's body instead of
// the side form. A plain textarea (the stored form is Markdown; the toolbar only inserts syntax) with Write / Preview, the section template for an empty about,
// "Save to draft" / Cancel, an inline "Discard changes?" when there are edits, Ctrl/Cmd + Enter saves. Saving sends the same about-only edit the forms send.
//   const ed = createAboutEditor({ target, initial, header, section, onClose(saved) });  ed.node, ed.footer, ed.band, ed.chips, ed.dirty(), ed.askDiscard(then)

import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { me } from '../design/who.js';
import { afterEdit } from '../design/after-edit.js';
import { sectionOffset } from '../design/pencil-pure.js';
import { TEMPLATE, TEMPLATE_CARET, ABOUT_MAX, wantsTemplate, isDirty, applyFormat, aboutEdit, lineOf } from './pane-edit-pure.js';
import { loadAbout, aboutBlocks } from './pane-about.js';
import { attachMentionPicker } from './pane-mention.js';

const TOOLS = [['h', 'H', 'Heading (## )'], ['bold', 'B', 'Bold'], ['italic', 'I', 'Italic'], ['strike', 'S', 'Strikethrough'], ['code', '</>', 'Code'], ['ul', '• list', 'Bulleted list'], ['ol', '1. list', 'Numbered list'], ['link', 'link', 'Link']];

export function createAboutEditor({ target, initial = '', header = {}, section = null, onClose }) {
  const empty = wantsTemplate(initial);
  const ta = h('textarea.pane-ta', { 'data-qa': 'about-text', spellcheck: true, 'aria-label': 'About, Markdown', value: empty ? TEMPLATE : initial });
  let templated = empty;
  const prev = h('div.pane-prev', { hidden: true, 'data-qa': 'about-preview' });
  const count = h('span');
  const err = h('div.error-box', { hidden: true, role: 'alert', 'data-qa': 'form-error' });
  const tpl = empty ? h('div.pane-tpl', { 'data-qa': 'about-template' }, h('span', "The about is empty, so the section template was inserted. Delete what you don't need."),
    h('button.u', { type: 'button', 'data-qa': 'undo-template', on: { click: () => { ta.value = ''; templated = false; tpl.remove(); paint(); ta.focus(); } } }, 'Undo template')) : null;

  const paint = () => { count.textContent = `${ta.value.length} characters`; count.style.color = ta.value.length > ABOUT_MAX ? 'var(--bad)' : ''; };
  const apply = (kind) => { const r = applyFormat(ta.value, ta.selectionStart, ta.selectionEnd, kind); ta.value = r.value; ta.setSelectionRange(r.start, r.end); ta.focus(); paint(); };
  const write = h('button.btn.sm', { type: 'button', 'data-qa': 'about-write', 'aria-pressed': 'true' }, 'Write'), view = h('button.btn.sm', { type: 'button', 'data-qa': 'about-view', 'aria-pressed': 'false' }, 'Preview');
  async function show(preview) {
    ta.hidden = preview; prev.hidden = !preview;
    write.setAttribute('aria-pressed', String(!preview)); view.setAttribute('aria-pressed', String(preview));
    if (!preview) { ta.focus(); return; }
    prev.replaceChildren(h('p.pane-loading', 'Loading…'));
    const model = await loadAbout(ta.value);
    if (!prev.hidden) prev.replaceChildren(h('div.pane-note', 'Preview, exactly as readers see it'), model.has ? aboutBlocks(model, {}) : h('p.pane-none', 'Nothing to preview.'));
  }
  write.addEventListener('click', () => show(false)); view.addEventListener('click', () => show(true));
  const tb = h('div.pane-tb', TOOLS.map(([k, label, title]) => h('button', { type: 'button', title, 'aria-label': title, 'data-qa': `tb-${k}`, on: { click: () => apply(k) } }, label)),
    h('button', { type: 'button', title: 'Mention someone (@)', 'aria-label': 'Mention someone', 'data-qa': 'tb-mention', on: { click: () => { ta.focus(); mention.open(); } } }, '@'), h('span.sp', h('span.pane-tabs', write, view)));
  const mention = attachMentionPicker(ta);
  ta.addEventListener('input', () => { if (ta.value !== TEMPLATE) templated = false; paint(); });

  const band = h('div.pane-draft', { 'data-qa': 'pane-draft' }, h('span', 'Editing in draft ', h('b', state.draft ?? ''), '. Nothing is saved until you press Save to draft.'));
  const node = h('div.pane-ed', tpl, h('div.pane-tbw', tb, ta, prev), h('div.pane-edmeta', h('span', 'Markdown: headings, lists, ', h('b', 'bold'), ', ', h('em', 'italic'), ', ', h('s', 'strike'), ', ', h('code', 'code'), ', links.'), count),
    h('div.pane-sanit', 'Not supported, and removed when rendered: ', h('code', '<script>'), ' ', h('code', '<img>'), ' raw HTML, ', h('code', 'javascript:'), ' links.'), err);

  const save = h('button.btn.primary', { type: 'button', 'data-qa': 'about-save' }, 'Save to draft'), cancel = h('button.btn', { type: 'button', 'data-qa': 'about-cancel' }, 'Cancel');
  const footer = h('div.pane-foot', { 'data-qa': 'pane-foot' }, h('span.hint', 'Ctrl/Cmd + Enter saves'), cancel, save);
  const normal = [...footer.children];
  const dirty = () => isDirty(templated ? TEMPLATE : initial, ta.value); // the untouched template is not a change; "Undo template" back to an empty about is not either

  function askDiscard(then) {
    footer.replaceChildren(h('span.hint', { role: 'alert' }, 'Discard changes?'), h('button.btn', { type: 'button', 'data-qa': 'keep-editing', on: { click: () => { footer.replaceChildren(...normal); ta.focus(); } } }, 'Keep editing'),
      h('button.btn.danger-ghost', { type: 'button', 'data-qa': 'discard', on: { click: () => { onClose(false); then?.(); } } }, 'Discard'));
    footer.querySelector('[data-qa=keep-editing]').focus();
  }
  cancel.addEventListener('click', () => (dirty() ? askDiscard() : onClose(false)));
  async function doSave() {
    err.hidden = true; save.disabled = true;
    try {
      await api.designEdit(state.env, state.draft, aboutEdit(target, ta.value, header), me());
      toast(`Saved to draft ${state.draft}`);
      onClose(true);
      afterEdit();
    } catch (e) { save.disabled = false; err.hidden = false; err.textContent = e.message; }
  }
  save.addEventListener('click', doSave);
  ta.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); doSave(); } });

  /** Put the caret where the pencil pointed: on the `## section` line, the first bullet of a template, or the top; scroll it into view. */
  function land() {
    const at = section ? Math.max(0, sectionOffset(ta.value, section)) : templated ? TEMPLATE_CARET : 0;
    ta.focus({ preventScroll: true });
    ta.setSelectionRange(at, at);
    const lh = parseFloat(getComputedStyle(ta).lineHeight) || 18;
    ta.scrollTop = Math.max(0, lineOf(ta.value, at) * lh - lh * 2);
  }
  paint();
  return { node, footer, band, dirty, askDiscard, land, chips: () => [h('span.st.new', 'in draft'), h('span.xs.muted', 'editing About')] };
}
