// Notes history (0.34.0, frame 20c): the version list (newest first) and, for the chosen version, its difference from the one before (Changes: only what
// changed, unchanged headings for context; or Full text), with "Restore this version", which writes the old text as a new version. Nothing is deleted.
// Removed text is on red with a strike and added text is on green with a left rule, so colour is never the only cue.

import { h } from '../dom.js';
import { api } from '../api.js';
import { sanitize } from '../../core/rich-text.js';
import { diffBlocks, changesOnly } from '../../core/notes.js';
import { relTime, fullDate } from '../comments/pure.js';
import { ensureUser } from '../users/signin.js';
import { renderChips } from '../users/chips.js';

/**
 * createHistory({ env, anchor, current, onBack(), onRestored(doc) }) -> { el, dispose() }
 * current: the version the document is at now (Restore is off for it).
 */
export function createHistory({ env, anchor, current, onBack, onRestored }) {
  let list = null, pick = current, mode = 'changes', alive = true, token = 0;
  const side = h('div.nt-hl', { role: 'listbox', 'aria-label': 'Versions' }), main = h('div.nt-hd');
  const back = h('button.nt-back', { type: 'button', 'data-qa': 'nt-back', on: { click: () => onBack?.() } }, '← Back to notes');
  const el = h('div.nt-hist', { 'data-qa': 'notes-history' }, back, h('div.nt-hcols', side, main));

  const block = (op) => renderChips(h('div.nt-blk.cm-body', { class: op.op, html: sanitize(op.html, { notes: true }) }));
  async function drawMain() {
    const mine = ++token, v = list.versions.find((x) => x.version === pick);
    main.replaceChildren(h('div.cm-hint', 'Loading…'));
    try {
      const [a, b] = await Promise.all([api.notes(env, anchor, pick), pick > 1 ? api.notes(env, anchor, pick - 1) : Promise.resolve({ body: '' })]);
      if (!alive || mine !== token) return;
      const ops = diffBlocks(b.body, a.body), shown = mode === 'changes' ? changesOnly(ops) : ops, changed = ops.some((o) => o.op !== 'same');
      const tog = (m, t) => h('button.abtn', { type: 'button', 'aria-pressed': String(mode === m), on: { click: () => { mode = m; drawMain(); } } }, t);
      const restore = h('button.btn.sm.primary', { type: 'button', disabled: pick === current, 'data-qa': 'nt-restore', title: pick === current ? 'This is the current version' : '', on: { click: () => doRestore(restore) } }, 'Restore this version');
      main.replaceChildren(
        h('div.nt-th', h('h3', `Version ${pick}${pick > 1 ? ` compared with ${pick - 1}` : ''}`), h('span.nt-tg', tog('changes', 'Changes'), tog('full', 'Full text')), restore),
        h('div.cm-hint', `${v?.author ?? ''} · ${v ? fullDate(v.createdAt) : ''}${v?.restoredFrom ? ` · Restored from version ${v.restoredFrom}` : ''}`),
        h('div.nt-diff', shown.length && (changed || mode === 'full') ? shown.map(block) : [h('div.cm-empty', pick > 1 ? 'No difference from the version before.' : 'The first version.')]));
    } catch (e) { if (alive && mine === token) main.replaceChildren(h('div.cm-err', e.message)); }
  }
  async function doRestore(btn) {
    btn.disabled = true;
    try {
      const user = await ensureUser('Sign in to restore. There are no passwords yet: picking a user only labels what you do.');
      onRestored?.(await api.restoreNotes(env, { anchor, version: pick, baseVersion: current, author: user.name }));
    } catch (e) { btn.disabled = false; if (!e.cancelled) main.prepend(h('div.cm-err', { role: 'alert' }, e.code === 'STALE_NOTES' ? 'Someone saved since you opened the history. Go back to the notes and open it again.' : e.message)); }
  }
  function drawSide() {
    const rows = list.versions.map((v) => h('button.nt-hv', { type: 'button', role: 'option', 'aria-selected': String(v.version === pick), class: v.version === pick ? 'on' : '', 'data-qa': 'nt-version', on: { click: () => { pick = v.version; drawSide(); drawMain(); } } },
      h('b', `Version ${v.version}`), v.version === current ? h('span.nt-cur', 'current') : null, h('span.cm-hint', `${v.author} · ${relTime(v.createdAt)}`, v.restoredFrom ? ` · restored from ${v.restoredFrom}` : '')));
    side.replaceChildren(...rows, list.total > list.versions.length ? h('div.cm-hint.nt-older', `${list.total - list.versions.length} older versions`) : null);
  }
  api.notesHistory(env, anchor).then((l) => { if (!alive) return; list = l; if (!l.versions.some((v) => v.version === pick)) pick = l.current; drawSide(); drawMain(); }).catch((e) => { main.replaceChildren(h('div.cm-err', e.message)); });
  return { el, dispose: () => { alive = false; } };
}
