// The Notes tab of a flow's bottom pane (0.34.0, frame 20): one rich document per flow, kept as versions. Read mode with the outline, the empty state
// with the template, edit mode (edit.js) and History (history.js). It loads the flow's notes, and again when the window is focused (the UI has no push
// channel; `notes.updated` is on /api/events for agents). Every environment has Notes, harvested ones too: notes are not harvested data.

import { h } from '../dom.js';
import { api } from '../api.js';
import { flowAnchor } from '../../core/comments.js';
import { hasNotes } from '../../core/notes.js';
import { relTime, fullDate } from '../comments/pure.js';
import { parseHash } from '../router.js';
import { docView } from './read.js';
import { createNotesEditor } from './edit.js';
import { createHistory } from './history.js';

/**
 * createNotes({ env, root: { service, ingress }, walk, pane, onStep(ref) }) -> { el, add(), onShow(), refresh(), dispose() }
 * pane: the pane's hub ({ shown(), reveal(), set(), tools(node|null), loaded(hasNotes) }); onStep(ref): a step chip was clicked (a clamped { from, to }).
 */
export function createNotes({ env, root, walk, pane, onStep }) {
  const anchor = flowAnchor(root.service, root.ingress);
  let cur = null, view = null, editor = null, hist = null, seq = 0, first = true, failed = '';
  const el = h('div.nt', { 'data-qa': 'notes' });
  const steps = () => walk.steps().length;

  const stop = () => { editor?.dispose(); editor = null; hist?.dispose(); hist = null; view?.dispose(); view = null; };
  function draw() {
    if (editor || hist) return;
    view?.dispose(); view = null;
    if (failed && !cur) { el.replaceChildren(h('div.cm-empty', `Notes could not be loaded: ${failed}`)); return; }
    if (!cur) { el.replaceChildren(h('div.cm-hint', 'Loading notes…')); return; }
    if (!hasNotes(cur.body)) {
      el.replaceChildren(h('div.nt-empty', { 'data-qa': 'nt-empty' }, 'No notes for this flow yet. Write the story of this flow.', h('br'),
        h('span.nt-eb', h('button.btn.sm.primary', { type: 'button', 'data-qa': 'nt-template', on: { click: () => edit(true) } }, 'Start from template'), h('button.btn.sm', { type: 'button', 'data-qa': 'nt-scratch', on: { click: () => edit(false) } }, 'Write from scratch'),
          cur.version ? h('button.btn.sm', { type: 'button', on: { click: history } }, 'History') : null),
        h('div.cm-hint.nt-tp', 'Template: Purpose · How it works · Decisions · Open questions')));
      return;
    }
    view = docView(cur.body, { steps, list: () => walk.steps(), hidden: (k) => walk.hiddenOf?.(k), onStep: (ref) => onStep?.(ref) });
    const meta = h('div.nt-meta', h('span', 'Edited by ', h('b', cur.author ?? 'someone'), ' · ', h('span', { title: fullDate(cur.createdAt) }, relTime(cur.createdAt)), ` · version ${cur.version}${cur.restoredFrom ? ` (restored from ${cur.restoredFrom})` : ''}`),
      h('button.abtn', { type: 'button', 'data-qa': 'nt-history', on: { click: history } }, 'History'));
    el.replaceChildren(meta, h('div.nt-wrap', view.el, view.outline));
  }

  function edit(template = false) {
    if (editor || !cur) return;
    hist?.dispose(); hist = null;
    pane.reveal();
    const done = (d) => { stop(); if (d) { cur = d; pane.loaded(hasNotes(d.body)); } draw(); };
    editor = createNotesEditor({ env, anchor, doc: cur, template, walk, pane, onSaved: done, onTheirs: done, onCancel: () => done(null) });
    el.replaceChildren(editor.el); editor.focus();
  }
  function history() {
    if (editor || hist || !cur) return;
    view?.dispose(); view = null;
    const back = () => { hist?.dispose(); hist = null; draw(); };
    hist = createHistory({ env, anchor, current: cur.version, onBack: back, onRestored: (d) => { cur = d; pane.loaded(hasNotes(d.body)); back(); } });
    el.replaceChildren(hist.el);
  }

  async function refresh() {
    const mine = ++seq;
    try {
      const d = await api.notes(env, anchor);
      if (mine !== seq) return;
      const changed = !cur || d.version !== cur.version; cur = d; failed = '';
      if (first) { first = false; pane.loaded(hasNotes(d.body)); if (parseHash().query.get('edit') === '1' && pane.shown()) edit(false); }
      if (changed) draw();
    } catch (e) { if (mine === seq && !cur) { failed = e.message; draw(); } }
  }
  const onFocus = () => { if (document.visibilityState !== 'hidden' && !editor) refresh(); };
  window.addEventListener('focus', onFocus); document.addEventListener('visibilitychange', onFocus);
  const unwatch = walk.watch(() => view?.relabel());
  draw(); refresh();
  return { el, add: () => edit(false), onShow: () => refresh(), refresh,
    dispose: () => { stop(); unwatch(); window.removeEventListener('focus', onFocus); document.removeEventListener('visibilitychange', onFocus); pane.tools(null); } };
}
