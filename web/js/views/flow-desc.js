// Flow descriptions in the UI: a small store (one fetch per flow, shared by every spot that shows it), the two-box block
// (Human first, then a collapsible AI box) and the one-line variant. Mockup: design/mockups/flow-activation.html, rev 4.
// The Human note is edited here (REST); the AI text is only ever written through MCP, so its box has no Edit, only "Generate…".

import { h } from '../dom.js';
import { api } from '../api.js';
import { lineText } from '../../core/description.js';

const none = { human: null, ai: null };
const pairOf = (d, callee) => (!d ? none : callee ? d.callees[callee] ?? none : d.flow);
export const fmtDate = (iso) => { try { return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); } catch { return ''; } };
const OPEN_KEY = 'flow-mapper.desc-ai-open';
const aiOpen = () => { try { const v = localStorage.getItem(OPEN_KEY); return v === null ? null : v === '1'; } catch { return null; } }; // null: the user never chose
const setAiOpen = (v) => { try { localStorage.setItem(OPEN_KEY, v ? '1' : '0'); } catch { /* storage unavailable */ } };

/** createDescStore(env) -> { watch(root, fn) -> unwatch, peek(root), save(root, callee, text), refresh(root) }. root: { service, ingress }. fn(data|null, error?) */
export function createDescStore(env) {
  const slot = new Map();
  const key = (r) => `${r.service}\t${r.ingress}`;
  const get = (r) => { const k = key(r); if (!slot.has(k)) slot.set(k, { data: null, error: null, subs: new Set(), loading: null }); return slot.get(k); };
  const emit = (s) => s.subs.forEach((fn) => fn(s.data, s.error));
  const refresh = (r) => {
    const s = get(r);
    s.loading = api.descriptions(env, r.service, r.ingress).then((d) => { s.data = d; s.error = null; }, (e) => { s.error = e.message; }).then(() => { s.loading = null; emit(s); });
    return s.loading;
  };
  return {
    peek: (r) => get(r).data,
    refresh,
    watch(r, fn) {
      const s = get(r);
      s.subs.add(fn);
      if (s.data || s.error) fn(s.data, s.error); else if (!s.loading) refresh(r);
      return () => s.subs.delete(fn);
    },
    async save(r, callee, text) {
      const s = get(r);
      s.data = await api.putDescription(env, { service: r.service, ingress: r.ingress, callee: callee || undefined, text });
      s.error = null; emit(s);
    },
  };
}

/** The editor for a Human note: a textarea with Save and Cancel. Ctrl/Cmd+Enter saves, Esc cancels (and stays inside, so it never closes a panel). */
function noteEditor({ initial, label, onSave, onCancel }) {
  const ta = h('textarea.textarea', { rows: 4, maxLength: 4000, 'aria-label': label, placeholder: 'What this is for, who owns it, what not to break.' }, initial ?? '');
  const err = h('span.small', { style: { color: 'var(--t-broken)' } });
  const save = h('button.btn.sm.primary', { on: { click: submit } }, 'Save');
  async function submit() {
    save.disabled = true; err.textContent = '';
    try { await onSave(ta.value); } catch (e) { err.textContent = e.message; save.disabled = false; }
  }
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); onCancel(); } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); }
  });
  const el = h('div.dbox.human.editing', h('div.dbox-h', h('span.who', 'Human'), h('span.grow'), h('span.muted', 'Saving an empty note removes it')), ta,
    h('div.edit-f', err, h('span.grow'), h('button.btn.sm', { on: { click: onCancel } }, 'Cancel'), save));
  return { el, focus: () => { ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); } };
}

const paras = (text) => String(text).split(/\n{2,}/).map((p) => h('p', { class: /^why it exists:/i.test(p.trim()) ? 'why' : '' }, p.trim()));

/**
 * descBlock(store, root, callee, { title, wholeFlow, onGenerate }) -> { el, dispose }
 * callee null = the whole flow. wholeFlow marks the "No description yet" state (a whole-flow description is required).
 * wide: the Human text is itself the click target for editing (flow and step boxes, 0.20.0). quiet: no title row, and no AI box until
 * there is AI text, no Generate (step descriptions: the AI text comes in through set_description).
 */
export function descBlock(store, root, callee, { title, wholeFlow, onGenerate, wide = false, quiet = false }) {
  const el = h('section.desc2', { class: wide ? 'wide' : '', 'aria-label': title });
  let data = null, error = null, editing = false, pendingFocus = false, choice = aiOpen();

  function human(p) {
    if (editing) {
      const ed = noteEditor({ initial: p.human?.text, label: `Human note: ${title}`, onCancel: () => { editing = false; render(); },
        onSave: async (t) => { await store.save(root, callee, t); editing = false; render(); } });
      queueMicrotask(() => ed.focus());
      return ed.el;
    }
    const start = (e) => { e.preventDefault(); editing = true; render(); };
    if (!p.human) return h('div.dbox.human.empty', h('span.who', 'Human'), h('i', 'No note yet'), h('span.grow'), h('a', { href: '#', on: { click: start } }, 'Add a note'));
    return h('div.dbox.human', h('div.dbox-h', h('span.who', 'Human'), h('span.meta', [p.human.editedBy && p.human.editedBy !== 'web' ? p.human.editedBy : null, fmtDate(p.human.editedAt)].filter(Boolean).join(' · ')),
      h('span.grow'), h('a', { href: '#', on: { click: start } }, 'Edit')), wide ? h('div.dtext', { title: 'Click to edit', on: { click: (e) => { if (!getSelection()?.toString()) start(e); } } }, paras(p.human.text)) : paras(p.human.text));
  }
  function ai(p) {
    if (quiet && !p.ai) return null;
    const gen = (label) => quiet ? null : h('button.btn.sm.gen', { title: 'Copy a prompt for your AI tool', on: { click: () => { pendingFocus = true; onGenerate(); } } }, label);
    if (!p.ai) return h('div.dbox.aibox.empty', h('span.ai.off', 'AI'), h('i', 'No AI description yet'), h('span.grow'), gen('✦ Generate…'));
    const a = p.ai, open = choice ?? !p.human; // collapsed by default when a Human note is there
    const chev = h('button.chev', { 'aria-expanded': String(open), 'aria-label': open ? 'Collapse the AI description' : 'Expand the AI description', on: { click: () => { choice = !open; setAiOpen(choice); render(); } } },
      h('span.chev-i', { class: open ? 'open' : '' }, '›'));
    return h('div.dbox.aibox', { class: a.outdated ? 'outdated' : '' }, h('div.dbox-h', chev, h('span.ai', 'AI'), h('span.who', 'AI'), h('span.meta', [a.model, fmtDate(a.generatedAt)].filter(Boolean).join(' · ')),
      a.outdated ? h('span.chip-warn', { title: 'The flow has changed since this was written. Generate it again to bring it up to date.' }, 'outdated') : null, h('span.grow'), gen('Generate…')),
      open ? [paras(a.text), h('div.desc-f', a.outdated ? 'Written from an earlier version of this flow. Use Generate to refresh.' : 'Written by an AI tool through the MCP server. Not editable here; use Generate again to replace it.')] : null);
  }
  function render() {
    if (editing && el.querySelector('.editing')) return; // a refresh from elsewhere must not eat what is being typed
    if (error && !data) { el.replaceChildren(h('div.desc-t', title), h('div.dbox.empty', h('i', `Descriptions are not available: ${error}`))); return; }
    const p = pairOf(data, callee);
    el.replaceChildren(...[quiet ? null : h('div.desc-t', title), human(p), ai(p)].filter(Boolean));
    if (pendingFocus && !document.querySelector('.dlg')) { pendingFocus = false; el.querySelector('.gen')?.focus(); } // the refresh replaced the button the dialog came from
  }
  render();
  const unwatch = store.watch(root, (d, e) => { data = d; error = e; render(); });
  return { el, dispose: unwatch };
}

/** One line (sub-flow tab header): the Human note if there is one, else the AI text, with the action that fits. keys: callee keys, most specific first. */
export function descLine(store, root, keys, { onGenerate }) {
  const el = h('div.descl');
  let data = null, editing = false, pendingFocus = false;
  const saveKey = keys[keys.length - 1];
  function render() {
    if (editing) {
      const ed = noteEditor({ initial: pairOf(data, saveKey).human?.text, label: `Human note: ${saveKey}`, onCancel: () => { editing = false; render(); },
        onSave: async (t) => { await store.save(root, saveKey, t); editing = false; render(); } });
      el.className = 'descl editing'; el.replaceChildren(ed.el); queueMicrotask(() => ed.focus());
      return;
    }
    const p = keys.map((k) => pairOf(data, k)).find((x) => x.human || x.ai) ?? none, l = lineText(p);
    const link = (label, fn, cls = '') => h('a', { href: '#', class: cls, on: { click: (e) => { e.preventDefault(); fn(); } } }, label);
    const note = link(p.human ? 'Edit' : 'Add a note', () => { editing = true; render(); });
    const gen = link('Generate…', () => { pendingFocus = true; onGenerate(); }, 'gen');
    el.className = `descl${l ? '' : ' empty'}`;
    el.replaceChildren(...(l ? [l.who === 'human' ? h('span.who-b', 'Human') : h('span.ai', 'AI'), h('span.dtxt', { title: l.text }, l.text),
      h('span.descl-a', l.outdated ? h('span.chip-warn', { title: 'The flow has changed since this was written.' }, 'outdated') : null, note, p.human ? null : gen)]
      : [h('span.ai.off', 'AI'), h('i.dtxt', data ? 'No description yet' : 'Loading…'), h('span.descl-a', note, gen)]));
    if (pendingFocus && !document.querySelector('.dlg')) { pendingFocus = false; el.querySelector('.gen')?.focus(); }
  }
  render();
  const unwatch = store.watch(root, (d) => { data = d; if (!editing) render(); });
  return { el, dispose: unwatch };
}
