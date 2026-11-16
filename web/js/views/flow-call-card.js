// The call card under the caption bar's step line (frame 28g): the note of the CALL, a full rich document (Unreleased: read with the Notes renderer, written with the same
// editor as the flow doc, in its compact form: toolbar, "/" menu, callouts Key / Watch / Risk, no outline, no History panel), a link to the flow doc's callout for the same
// step, and, in Edit mode, "+ Add call description". The text belongs to the call (flow-call-store.js), so every flow that uses it shows the same. Quiet when there is
// nothing: View mode draws nothing at all. A save is a new version (the Notes storage keeps them all), made by the editor itself (notes/edit.js) from the version it opened.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { me } from '../users/directory.js';
import { callOf } from './flow-call-store.js';
import { callAnchor, parseCall, hasCall } from '../../core/call-notes.js';
import { docView } from '../notes/read.js';
import { createNotesEditor } from '../notes/edit.js';
import { textSize } from '../notes/text-size.js';

/** createCallCard({ store, canEdit(), docLink(n) -> fn | null }) -> { el, size (the text size control), paint(step | null, n), hasText(step), what(step), editing(), cancel() } */
export function createCallCard({ store, canEdit, quiet = () => false, docLink = () => null, onChange = () => {} }) {
  const el = h('div.cap-card', { 'data-qa': 'call-card', hidden: true }), size = textSize('call', el);
  let step = null, n = 0, form = false, editor = null, view = null, opening = false;
  const call = () => callOf(step);
  const note = (st = step) => store.of(callOf(st)) ?? null;

  const stop = () => { editor?.dispose(); editor = null; view?.dispose(); view = null; };
  async function open() {
    const c = call();
    if (!c || form || opening) return;
    opening = true;
    try {
      const d = await api.notes(store.env, callAnchor(c.from, c.to, c.op)); // the version to write from (an emptied note has one too)
      form = true; edit(c, d);
    } catch { /* the card keeps its read view */ } finally { opening = false; }
  }
  function edit(c, d) {
    stop();
    const act = h('div.cc-act'), done = (saved) => { stop(); form = false; if (saved) store.adopt(c, saved); paint(step, n); onChange(); };
    const pane = { tools: (node) => act.replaceChildren(...(node ? [node] : [])) };
    editor = createNotesEditor({ env: store.env, anchor: callAnchor(c.from, c.to, c.op), kind: 'call', doc: d, template: !hasCall(parseCall(d.body)), pane, onSaved: done, onTheirs: done, onCancel: () => done(null) });
    el.hidden = false; el.replaceChildren(h('div.cc-editor', editor.el, act)); editor.focus(); onChange();
  }
  function cancel() { if (form) editor?.cancel(); }

  function paint(st, num) {
    if (editor) return; // writing: the card stays on the call it opened
    step = st; n = num;
    stop();
    if (!st) { el.hidden = true; el.replaceChildren(); return; }
    const cur = note(), ed = canEdit() && !!callOf(st);
    form = false;
    if (!cur) {
      const q = quiet(), show = ed && (!q || !!me()); // View mode: only a signed-in editor gets the one muted line
      el.hidden = !show;
      el.replaceChildren(show ? h(q ? 'button.cc-add.quiet' : 'button.cc-add', { type: 'button', 'data-qa': 'add-call-note', on: { click: open } }, ...(q ? ['+ describe this call'] : [icon('plus'), 'Add call description'])) : '');
      return;
    }
    const link = docLink(n), a = link ? h('a', { href: '#', 'data-qa': 'cc-doc', on: { click: (e) => { e.preventDefault(); link(); } } }, 'Flow doc') : null;
    view = docView(cur.body, { env: store.env });
    el.hidden = false;
    el.replaceChildren(...[h('div.cc-read', { 'data-qa': 'cc-read' }, view.el, a ? h('p.cc-doclink', 'A callout on this step: ', a) : null),
      ed ? h('button.cc-edit', { type: 'button', 'data-qa': 'edit-call-note', 'aria-label': 'Edit call description', title: 'Edit this call’s description', on: { click: open } }, icon('edit')) : null].filter(Boolean));
  }
  return { el, size: size.el, paint, hasText: (st) => !!note(st), what: (st) => note(st)?.note.first ?? '', editing: () => form, cancel };
}
