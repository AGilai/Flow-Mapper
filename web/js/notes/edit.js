// Notes in edit mode (0.34.0, frame 20b): the comment editor plus a Heading menu and a step-chip button. Save and Cancel replace "+ Add" in the tab row
// (Ctrl/Cmd+S saves, Esc asks when there are unsaved changes). A draft autosaves per viewer in this browser; the saved version only changes on Save.
// A Save names the version it started from: if someone saved since, the server answers 409 and the editor offers "Keep mine" / "Open theirs".

import { h } from '../dom.js';
import { api } from '../api.js';
import { createEditor } from '../comments/rte.js';
import { createToolbar } from '../comments/rte-toolbar.js';
import { ensureUser } from '../users/signin.js';
import { TEMPLATE, templateHtml } from '../../core/notes.js';
import { notesTools } from './edit-toolbar.js';

const key = (env, anchor) => `flow-mapper.notes-draft:${env}:${anchor}`;
const readDraft = (k) => { try { return JSON.parse(localStorage.getItem(k) ?? 'null'); } catch { return null; } };
const writeDraft = (k, v) => { try { if (v) localStorage.setItem(k, JSON.stringify(v)); else localStorage.removeItem(k); } catch { /* storage unavailable */ } };
const clock = (t) => new Date(t).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

/**
 * createNotesEditor({ env, anchor, doc, template, walk, pane, onSaved(doc), onTheirs(doc), onCancel() }) -> { el, focus(), dirty(), dispose() }
 * doc: the version the viewer started from (version 0: none yet). template: start from the Purpose / How it works / Decisions / Open questions headings.
 */
export function createNotesEditor({ env, anchor, doc, template = false, walk, pane, onSaved, onTheirs, onCancel }) {
  const k = key(env, anchor), draft = readDraft(k);
  const useDraft = !template && draft && typeof draft.html === 'string' && draft.html !== doc.body;
  let base = doc.version, timer = 0, ask = false, busy = false;
  const hint = h('div.cm-hint.nt-ehint', { role: 'status' }), saved = h('span.nt-draft'), err = h('div.cm-err', { role: 'alert' }), bar = h('div.nt-bar', { hidden: true });
  const stepNow = () => { const s = walk?.picked() ? walk.steps()[walk.current() - 1] : null; return s ? { n: s.n } : null; };
  let ed, tb, nt;
  ed = createEditor({ html: '', label: 'Notes', placeholder: 'Write the story of this flow…', notes: true, onSubmit: () => save(), onEscape: () => cancel(), onChange: () => { tb?.update(); nt?.update(); dirtyNote(); } });
  tb = createToolbar(ed); nt = notesTools(ed, tb, { stepNow });
  tb.el.append(saved);
  if (template) { ed.setHtml(templateHtml()); hints(); } else ed.setHtml(useDraft ? draft.html : doc.body);
  const start = ed.getHtml();
  hint.textContent = template ? 'Template inserted. Delete any heading you do not need.' : useDraft ? `Your draft from ${clock(draft.at)} was restored.` : '';
  if (doc.version) hint.textContent += `${hint.textContent ? ' ' : ''}Others see version ${doc.version} until you save.`;
  if (useDraft) hint.append(' ', h('button.lnk', { type: 'button', 'data-qa': 'nt-discard-draft', on: { click: () => { ed.setHtml(doc.body); writeDraft(k, null); hint.textContent = `Draft discarded. Others see version ${doc.version}.`; } } }, 'Discard draft'));
  const wrap = h('div.rte-wrap.nt-wrap', tb.el, ed.el);
  const el = h('div.nt-edit', { 'data-qa': 'notes-edit' }, hint, wrap, err, bar);
  el.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); } });

  function hints() { // the template's grey hints: attributes of the editor's DOM only (the sanitizer drops them on save), gone as soon as there is text
    [...ed.el.querySelectorAll('h2')].forEach((hd, i) => { const p = hd.nextElementSibling; if (p && TEMPLATE[i]) p.setAttribute('data-ph', TEMPLATE[i][1]); });
  }
  const dirty = () => ed.getHtml() !== start;
  function dirtyNote() { clearTimeout(timer); timer = setTimeout(() => { const html = ed.getHtml(); writeDraft(k, html === doc.body || html === start && !useDraft ? null : { html, at: Date.now(), base }); if (html !== start) saved.textContent = `Draft saved ${clock(Date.now())}`; }, 700); }

  const notice = (...c) => { bar.hidden = !c.length; bar.replaceChildren(...c); bar.querySelector('button')?.focus(); };
  function cancel() {
    if (busy) return;
    if (!dirty()) { writeDraft(k, null); onCancel?.(); return; }
    if (ask) return;
    ask = true;
    notice(h('span', 'Discard your changes?'), h('button.btn.sm', { type: 'button', on: { click: () => { ask = false; notice(); ed.focus(); } } }, 'Keep editing'), h('button.btn.sm.danger', { type: 'button', 'data-qa': 'nt-discard', on: { click: () => { writeDraft(k, null); onCancel?.(); } } }, 'Discard'));
  }
  async function save(current = null) {
    if (busy) return;
    const html = ed.getHtml();
    if (!html && !doc.version) { onCancel?.(); return; }
    busy = true; err.textContent = ''; sync();
    try {
      const user = await ensureUser('Sign in to save notes. There are no passwords yet: picking a user only labels what you write.');
      const d = await api.saveNotes(env, { anchor, body: html, baseVersion: current ? current.version : base, author: user.name });
      writeDraft(k, null); busy = false; onSaved?.(d);
    } catch (e) {
      busy = false; sync();
      if (e.code === 'STALE_NOTES' && e.details?.current) stale(e.details.current);
      else err.textContent = e.cancelled ? '' : e.message || 'Could not save the notes.';
    }
  }
  function stale(cur) { // someone saved since the viewer opened the notes: never a silent overwrite
    notice(h('span', h('b', cur.author ?? 'Someone'), ` saved version ${cur.version} while you were editing.`),
      h('button.btn.sm.primary', { type: 'button', 'data-qa': 'nt-keep-mine', on: { click: () => { notice(); save(cur); } } }, `Keep mine (saves as version ${cur.version + 1})`),
      h('button.btn.sm', { type: 'button', 'data-qa': 'nt-open-theirs', on: { click: () => { writeDraft(k, { html: ed.getHtml(), at: Date.now(), base }); onTheirs?.(cur); } } }, 'Open theirs'));
  }

  const saveBtn = h('button.btn.sm.primary', { type: 'button', 'data-qa': 'nt-save', on: { click: () => save() } }, 'Save');
  const cancelBtn = h('button.btn.sm', { type: 'button', 'data-qa': 'nt-cancel', on: { click: () => cancel() } }, 'Cancel');
  const sync = () => { saveBtn.disabled = busy; cancelBtn.disabled = busy; };
  pane.tools(h('span.pane-btns', cancelBtn, saveBtn));
  return { el, focus: () => ed.focus(false), dirty, dispose: () => { clearTimeout(timer); nt.dispose(); tb.dispose(); ed.dispose(); pane.tools(null); } };
}
