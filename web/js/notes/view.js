// A document of the app (0.34.0 Notes of a flow; Unreleased: also the design doc of an environment): one rich document kept as versions. Read mode with the outline,
// the empty state with the template, edit mode (edit.js) and History (history.js). It loads the document, and again when the window is focused (the UI has no push
// channel; `notes.updated` is on /api/events for agents). Every environment has them, harvested ones too: they are not harvested data.
// kind 'flow' (the default): the flow doc, anchor flow:<service>/<ingress>, tied to the step walk. kind 'env': the design doc, anchor `env`, no walk.

import { h } from '../dom.js';
import { api } from '../api.js';
import { flowAnchor } from '../../core/comments.js';
import { ENV_DOC, hasNotes } from '../../core/notes.js';
import { relTime, fullDate } from '../comments/pure.js';
import { parseHash } from '../router.js';
import { docView } from './read.js';
import { createNotesEditor } from './edit.js';
import { createHistory } from './history.js';

const NO_WALK = { steps: () => [], list: () => [], watch: () => () => {}, picked: () => false, current: () => 0 };
const TEXT = {
  flow: { name: 'Notes', empty: 'No notes for this flow yet. Write the story of this flow.', tip: 'Template: Purpose · How it works · Decisions · Open questions' },
  env: { name: 'The design doc', empty: 'No design doc for this environment yet. Write the document the whole team reads first.', tip: 'Template: Purpose · How it works · Decisions · Open questions' },
};

/**
 * createNotes({ env, root: { service, ingress }, kind, walk, pane, onStep(ref), onBody(html), onHover(step | null), canEdit }) -> { el, add(), onShow(), refresh(), history(), isEditing(), leave(), focusCallout(step), dispose() }
 * pane: the host's hub ({ shown(), reveal(), set(), tools(node|null), loaded(hasNotes) }); onStep(ref): a step chip was clicked (a clamped { from, to });
 * onDoc(doc): the current version (author, time, number), for a header that says who edited it; onBody(html): the sanitized body of the current version (null while there is none), for the diagram's badges; canEdit: false hides every way into the editor (a viewer).
 */
export function createNotes({ env, root, kind = 'flow', walk = NO_WALK, pane, onStep, onBody, onHover, onDoc, canEdit = true }) {
  const anchor = kind === 'env' ? ENV_DOC : flowAnchor(root.service, root.ingress), T = TEXT[kind];
  let cur = null, view = null, editor = null, hist = null, seq = 0, first = true, failed = '';
  const el = h('div.nt', { 'data-qa': kind === 'env' ? 'design-doc' : 'notes', class: kind === 'env' ? 'nt-env' : '' });
  const steps = () => walk.steps().length;

  const stop = () => { editor?.dispose(); editor = null; hist?.dispose(); hist = null; view?.dispose(); view = null; };
  const body = () => { onBody?.(cur && hasNotes(cur.body) ? cur.body : null); onDoc?.(cur); };
  function draw() {
    if (editor || hist) return;
    view?.dispose(); view = null;
    if (failed && !cur) { el.replaceChildren(h('div.cm-empty', `${T.name} could not be loaded: ${failed}`)); return; }
    if (!cur) { el.replaceChildren(h('div.cm-hint', 'Loading…')); return; }
    if (!hasNotes(cur.body)) {
      el.replaceChildren(h('div.nt-empty', { 'data-qa': 'nt-empty' }, T.empty, h('br'),
        h('span.nt-eb', canEdit ? [h('button.btn.sm.primary', { type: 'button', 'data-qa': 'nt-template', on: { click: () => edit(true) } }, 'Start from template'), h('button.btn.sm', { type: 'button', 'data-qa': 'nt-scratch', on: { click: () => edit(false) } }, 'Write from scratch')] : null,
          cur.version ? h('button.btn.sm', { type: 'button', on: { click: history } }, 'History') : null),
        canEdit ? h('div.cm-hint.nt-tp', T.tip) : h('div.cm-hint.nt-tp', 'You can read it here; editing needs editor rights.')));
      return;
    }
    view = docView(cur.body, { steps, list: () => walk.list(), hidden: (k) => walk.hiddenOf?.(k), onStep: (ref) => onStep?.(ref), env, onHover });
    const meta = h('div.nt-meta', h('span', 'Edited by ', h('b', cur.author ?? 'someone'), ' · ', h('span', { title: fullDate(cur.createdAt) }, relTime(cur.createdAt)), ` · version ${cur.version}${cur.restoredFrom ? ` (restored from ${cur.restoredFrom})` : ''}`),
      h('button.abtn', { type: 'button', 'data-qa': 'nt-history', on: { click: history } }, 'History'));
    el.replaceChildren(meta, h('div.nt-wrap', view.el, view.outline));
  }

  function edit(template = false) {
    if (editor || !cur || !canEdit) return;
    hist?.dispose(); hist = null;
    pane.reveal();
    const done = (d) => { stop(); if (d) { cur = d; pane.loaded(hasNotes(d.body)); body(); } draw(); pane.mode?.(false); };
    editor = createNotesEditor({ env, anchor, kind, doc: cur, template, walk, pane, onSaved: done, onTheirs: done, onCancel: () => done(null) });
    el.replaceChildren(editor.el); editor.focus(); pane.mode?.(true);
  }
  function history() {
    if (editor || hist || !cur) return;
    view?.dispose(); view = null;
    const back = () => { hist?.dispose(); hist = null; draw(); };
    hist = createHistory({ env, anchor, current: cur.version, canRestore: canEdit, onBack: back, onRestored: (d) => { cur = d; pane.loaded(hasNotes(d.body)); body(); back(); } });
    el.replaceChildren(hist.el);
  }

  async function refresh() {
    const mine = ++seq;
    try {
      const d = await api.notes(env, anchor);
      if (mine !== seq) return;
      const changed = !cur || d.version !== cur.version; cur = d; failed = '';
      if (first) { first = false; pane.loaded(hasNotes(d.body)); if (parseHash().query.get('edit') === '1' && pane.shown() && kind === 'flow') edit(false); }
      if (changed) { body(); draw(); }
    } catch (e) { if (mine === seq && !cur) { failed = e.message; draw(); } }
  }
  const onFocus = () => { if (document.visibilityState !== 'hidden' && !editor) refresh(); };
  window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
  let nSteps = -1; const unwatch = walk.watch(() => { view?.relabel(); if (steps() !== nSteps) { nSteps = steps(); body(); } }); // the badges follow the number of steps, not every move of the walk
  draw(); refresh();
  return { el, add: () => edit(false), onShow: () => refresh(), refresh, history, isEditing: () => !!editor, leave: () => editor?.cancel(), focusCallout: (n) => view?.focusCallout(n) ?? false, hasDoc: () => !!cur && hasNotes(cur.body), editorApi: () => editor,
    dispose: () => { stop(); unwatch(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); pane.tools(null); } };
}
