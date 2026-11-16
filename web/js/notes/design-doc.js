// The design doc of an environment (Unreleased, frame 28d/e): the Notes document with the anchor `env`, one controller for both of its places, the page
// (views/design-doc.js) and the dock beside the work (dock.js). It owns the document view and the controls that go with it: History, View | Edit, the
// Save / Cancel the editor hands over, and the "Edited by" line. Who may edit follows the Notes rules: any viewer annotates a sealed environment, a design
// needs editor rights (server/auth/rules.ts); a viewer reads, and the Edit button says why it is off.

import { h } from '../dom.js';
import { isDesign } from '../state.js';
import { canEditEnv } from '../account.js';
import { relTime } from '../comments/pure.js';
import { createNotes } from './view.js';
import { textSize } from './text-size.js';

/** May the viewer write the document of `env`? (Server rules, mirrored so the button is honest.) */
export const canWriteDoc = (env) => !isDesign(env) || canEditEnv(env);

/**
 * createDesignDoc({ env }) -> { notes, el (the document), controls: { history, seg, tools, meta, size }, editing(), onEdit(fn), dispose() }
 * `controls` are nodes the caller lays out in its own bar.
 */
export function createDesignDoc({ env }) {
  const can = canWriteDoc(env), listeners = new Set();
  const tools = h('span.fp-btns', { 'data-qa': 'dd-tools' }), meta = h('span.dd-meta', { 'data-qa': 'dd-meta' });
  const view = h('button', { type: 'button', 'aria-pressed': 'true', class: 'on', 'data-qa': 'dd-view', on: { click: () => { if (notes.isEditing()) notes.leave(); } } }, 'View');
  const edit = h('button', { type: 'button', 'aria-pressed': 'false', disabled: !can, 'data-qa': 'dd-edit', title: can ? 'Edit the design doc' : 'Editing needs editor rights in this environment', on: { click: () => { if (!notes.isEditing()) notes.add(); } } }, 'Edit');
  const seg = h('span.dd-seg', { role: 'group', 'aria-label': 'View or edit' }, view, edit);
  const history = h('button.btn.sm', { type: 'button', 'data-qa': 'dd-history', title: 'Versions of the design doc', on: { click: () => notes.history() } }, 'History');
  const paint = (on) => { view.classList.toggle('on', !on); edit.classList.toggle('on', on); view.setAttribute('aria-pressed', String(!on)); edit.setAttribute('aria-pressed', String(on)); history.disabled = on; listeners.forEach((f) => f(on)); };
  const pane = { shown: () => true, reveal() {}, set() {}, loaded() {}, tools: (n) => tools.replaceChildren(...(n ? [n] : [])), mode: paint };
  const notes = createNotes({ env, kind: 'env', pane, canEdit: can, onDoc: (d) => { meta.textContent = d?.version ? `Edited by ${d.author ?? 'someone'}, ${relTime(d.createdAt)} · v${d.version}` : ''; } });
  return { notes, el: notes.el, controls: { history, seg, tools, meta, size: textSize('envdoc', notes.el).el }, editing: () => notes.isEditing(), onEdit: (f) => { listeners.add(f); return () => listeners.delete(f); }, dispose: () => { listeners.clear(); notes.dispose(); } };
}
