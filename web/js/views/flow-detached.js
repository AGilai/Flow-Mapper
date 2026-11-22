// Detached step notes (0.70.1): a note is stored under a key built from the step's label, so when the label or its note changes the text stays under
// the old key and shows nowhere. This is the calm notice "N detached step notes" under the flow's description; it opens a list where each note can
// move to a current step (the most similar one is preselected) or be deleted (asked in the row, never in a browser dialog).

import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { stepLabelOf } from '../../core/description.js';
import { fmtDate } from './flow-desc.js';

const words = (s) => new Set(String(s).toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 1));
/** The key of the step whose label shares the most words with the old label (Jaccard), or the first one; '' without steps. */
export function similarStep(oldKey, steps) {
  const a = words(stepLabelOf(oldKey));
  let best = steps[0]?.key ?? '', top = -1;
  for (const s of steps) {
    const b = words(s.label), both = [...a].filter((w) => b.has(w)).length, score = both / (a.size + b.size - both || 1);
    if (score > top) { top = score; best = s.key; }
  }
  return best;
}

/** The current steps of a trace as {key, label}, once per key (returns have none). */
export const stepsOfTrace = (messages) => {
  const seen = new Set(), out = [];
  for (const m of messages ?? []) if (m.key && m.kind !== 'return' && !seen.has(m.key)) { seen.add(m.key); out.push({ key: m.key, label: `${out.length + 1}. ${stepLabelOf(m.key)}` }); }
  return out;
};

/** createDetached({ env, store, root, steps: () => [{key, label}], readOnly }) -> { el, dispose }. The element is hidden while nothing is detached. */
export function createDetached({ env, store, root, steps, readOnly = false }) {
  const el = h('section.det-sec', { 'data-qa': 'detached-notes', hidden: true, 'aria-label': 'Detached step notes' });
  let list = [], open = false, busy = null, mode = null; // mode: { key, kind: 'move' | 'delete', to? } the row that is being moved or confirmed
  const byKey = () => { const m = new Map(); for (const r of list) m.set(r.key, [...(m.get(r.key) ?? []), r]); return [...m]; };

  async function send(body, done) {
    busy = body.callee; draw();
    try { await api.putDescription(env, { service: root.service, ingress: root.ingress, ...body }); mode = null; await store.refresh(root); toast(done); } catch (e) { toast(e.message || 'Could not save'); } finally { busy = null; draw(); }
  }

  function row([key, recs]) {
    const first = recs.find((r) => r.source === 'human') ?? recs[0], ai = recs.some((r) => r.source === 'ai'), me = mode?.key === key ? mode : null;
    const acts = readOnly ? null : me?.kind === 'move' ? moveBar(key, me) : me?.kind === 'delete' ? h('div.det-acts', { role: 'group', 'aria-label': 'Confirm delete' },
      h('span.small', 'Delete this note for good?'), h('button.btn.sm.danger-ghost', { type: 'button', disabled: busy === key, on: { click: () => send({ callee: key, text: '', title: '' }, 'Note deleted') } }, 'Delete'),
      h('button.btn.sm', { type: 'button', on: { click: () => { mode = null; draw(); } } }, 'Cancel'))
      : h('div.det-acts', h('button.btn.sm', { type: 'button', on: { click: () => { mode = { key, kind: 'move', to: similarStep(key, steps()) }; draw(); } } }, 'Move to step…'),
        h('button.btn.sm', { type: 'button', on: { click: () => { mode = { key, kind: 'delete' }; draw(); } } }, 'Delete'));
    return h('li.det-row', { 'data-qa': 'detached-row' },
      h('div.det-old', h('span.muted.small', 'Was on'), ' ', h('span.mono.det-label', stepLabelOf(key))),
      first.title ? h('div.det-title', first.title) : null,
      h('div.det-text', recs.map((r) => h('p', { class: r.source === 'ai' ? 'det-ai' : '' }, r.source === 'ai' && recs.length > 1 ? [h('span.det-who', 'AI'), ' ', r.text] : r.text))),
      h('div.muted.small', `${first.author || 'unknown'} · ${fmtDate(first.updatedAt)}${ai && first.source !== 'ai' ? ' · and an AI text' : ''}`), acts);
  }

  function moveBar(key, me) {
    const opts = steps(), sel = h('select.select', { 'aria-label': 'Move to step', on: { change: (e) => { me.to = e.target.value; } } }, opts.map((s) => h('option', { value: s.key, selected: s.key === me.to }, s.label)));
    return h('div.det-acts', { role: 'group', 'aria-label': 'Move to step' }, sel,
      h('button.btn.sm.primary', { type: 'button', disabled: !opts.length || busy === key, on: { click: () => send({ callee: key, moveTo: sel.value }, 'Note moved') } }, 'Move'),
      h('button.btn.sm', { type: 'button', on: { click: () => { mode = null; draw(); } } }, 'Cancel'));
  }

  function draw() {
    el.hidden = !list.length;
    if (!list.length) { el.replaceChildren(); return; }
    const n = byKey().length;
    el.replaceChildren(h('button.det-chip', { type: 'button', 'aria-expanded': String(open), 'data-qa': 'detached-toggle', on: { click: () => { open = !open; draw(); } } },
      h('span.det-dot', { 'aria-hidden': 'true' }), `${n} detached step note${n === 1 ? '' : 's'}`, h('span.det-hint', open ? 'Hide' : 'Review')),
    open ? h('div.det-body', h('p.muted.small', 'These notes were written for steps whose label or note has changed since, so they show on no step. Move one to the step it belongs to, or delete it.'),
      h('ul.det-list', byKey().map(row))) : null);
  }

  const un = store.watch(root, (d) => { list = d?.detached ?? []; if (mode && !list.some((r) => r.key === mode.key)) mode = null; draw(); });
  return { el, dispose: () => un?.() };
}
