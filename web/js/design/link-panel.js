// The side panel of an abstract link (0.28.1, frame 3): what it is (chips, name, "Network (POP) → Platform · drawn at subsystem level", description), what is wrong
// with it, the Refine grid (From › Via › To), the suggestions with "Use <name>", and in Edit with a draft Edit and Delete. View mode is read-only
// ("Open a draft to refine"). Every change is one `designEdit`; the page draws again with the panel open on the same link (`link=` in the URL).

import { h, fill, toast } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { setQuery } from '../router.js';
import { glyph } from '../components/status-mark.js';
import { me } from './who.js';
import { afterEdit } from './after-edit.js';
import { openLinkForm } from './forms/link-form.js';
import { openCallForm } from './forms/call-form.js';
import { NEW_CALL, refineModel, choiceEdit, callEdit, suggestionEdit, suggestionLabel, waitingText } from './refine-state.js';

const opt = (value, label, selected) => h('option', { value, selected }, label);
const MARK = { new: ['new', 'New'], changed: ['chg', 'Changed'] };

/** The head: chips (mode, state, mark), the name and the ends. */
function head(view, subs, mark) {
  const label = (e) => `${subs.labelOf(e.subsystem)}${e.service ? ` › ${e.service}` : ''}`;
  const m = MARK[mark?.mark];
  return h('div.stack', { style: { gap: '4px' } },
    h('div.row', { style: { gap: '6px', flexWrap: 'wrap' } }, view.mode ? h('span.chip', { 'data-t': view.mode === 'async' ? 'async' : 'http' }, view.mode) : null, h('span.pill', { 'data-qa': 'link-state' }, view.state),
      m ? h(`span.mark.${m[0]}`, glyph(mark.mark), m[1]) : null),
    h('h3.link-name', view.name), h('span.xs.muted', `${label(view.from)} → ${label(view.to)} · ${view.state === 'refined' ? 'refined: part of a rolled-up line' : 'drawn at subsystem level'}`));
}

/** openLinkPanel(view, { panel, subs, marks, map, editing }): shows the panel at once and adds the suggestions when they arrive. */
export async function openLinkPanel(view, { panel, subs, marks, map, editing }) {
  const choice = { from: '', via: '', to: '', toEp: '' }, body = h('div.stack', { style: { gap: 'var(--s3)' } }), err = h('div.error-box', { hidden: true, role: 'alert' });
  let suggestions = [];
  const send = async (edit) => {
    err.hidden = true;
    try { await api.designEdit(state.env, state.draft, edit, me()); toast(`Saved to draft ${state.draft}`); setQuery({ link: view.id }); afterEdit(); }
    catch (e) { err.textContent = e.message; err.hidden = false; }
  };
  const line = map?.lines.find((l) => l.id === view.line);
  const paint = async () => {
    const mdl = refineModel(view, choice, (k) => subs.info(k)?.components.map((c) => c.name) ?? [], suggestions);
    let eps = [];
    if (mdl.epOpen) eps = ((await api.service(state.env, mdl.to.value || view.to.service).catch(() => null))?.ingress ?? []);
    const sel = (key, options, value, extra = {}) => h('select.select', { 'aria-label': key, ...extra, on: { change: (e) => { choice[key] = e.target.value; if (key === 'from') choice.via = ''; if (key === 'to') choice.toEp = ''; paint(); } } }, options);
    const grid = h('div.fgrid', { 'data-qa': 'refine-grid' },
      h('span.flab', 'From'), h('div.fctl', mdl.from.open ? sel('from', [opt('', `${subs.labelOf(view.from.subsystem)} › pick a component`, !choice.from), mdl.from.options.map((n) => opt(n, n, n === choice.from))])
        : h('span.mono', mdl.from.value || subs.labelOf(view.from.subsystem))),
      h('span.flab', 'Via'), h('div.fctl', sel('via', [opt('', mdl.via.open ? 'not chosen' : 'pick a From component first', !choice.via), mdl.via.open ? mdl.via.options.map((o) => opt(o.value, o.label, o.value === choice.via)) : null], { disabled: !mdl.via.open })),
      h('span.flab', 'To'), h('div.fctl', mdl.to.open ? sel('to', [opt('', `${subs.labelOf(view.to.subsystem)} › pick a component`, !choice.to), mdl.to.options.map((n) => opt(n, n, n === choice.to))]) : h('span.mono', mdl.to.value || subs.labelOf(view.to.subsystem)),
        mdl.epOpen ? sel('toEp', [opt('', 'endpoint: pick one', !choice.toEp), eps.map((i) => opt(i.id, i.bindKey, i.id === choice.toEp))]) : null));
    const what = choiceEdit(view, choice), go = h('button.btn.primary.sm', { type: 'button', 'data-qa': 'refine-go', disabled: !what, on: { click: () => (what.action === 'call' ? makeCall(what) : send(what.edit)) } },
      what?.action === 'call' ? 'Make it a call…' : what?.action === 'use' ? `Use ${choice.via}` : 'Narrow the ends');
    fill(body, view.state === 'refined' ? null : [h('div', h('h4.link-h', 'Refine'), grid, h('div.row', { style: { marginTop: 'var(--s2)' } }, go))],
      view.state === 'refined' ? h('p.small', { 'data-qa': 'link-refined' }, `Realised by ${view.refinedBy.map((r) => `${r.service} · ${r.egress}`).join(', ')}${line ? `; counted in "${line.count} ${line.mode === 'async' ? 'async' : 'calls'} · ${line.transport}"` : ''}.`) : null,
      view.state !== 'refined' && suggestions.length ? suggestions.slice(0, 3).map((s) => h('div.info.xs', { 'data-qa': 'link-suggestion' }, h('span', h('b', 'Suggestion'), ` from the design: ${s.reason}.`),
        h('span.acts', h('button.btn.sm', { type: 'button', disabled: !state.draft, on: { click: () => send(suggestionEdit(view, s)) } }, suggestionLabel(s))))) : null,
      view.state !== 'refined' ? h('div.row', { style: { gap: '6px' } }, h('button.btn.sm', { type: 'button', 'data-qa': 'make-call', disabled: !state.draft, on: { click: () => makeCall({ from: choice.from || view.from.service || '', to: choice.to || view.to.service ? { service: choice.to || view.to.service, ingress: choice.toEp || undefined } : null }) } }, 'Make it a call…')) : null,
      h('p.xs.muted', waitingText(view)));
  };
  async function makeCall({ from, to }) {
    if (!from) { err.textContent = 'Pick a From component first.'; err.hidden = false; return; }
    const fn = (await api.service(state.env, from).catch(() => null))?.functions?.[0]?.name ?? '';
    openCallForm({ panel, flowsEl: null, from: { service: from, fn }, to, title: `Make "${view.name}" a call`, wrap: (c) => callEdit(view.id, c) });
  }
  const static_ = h('div.stack', { style: { gap: 'var(--s3)' } },
    view.description ? h('p.small', { style: { color: 'var(--ink-2)' } }, view.description) : null,
    view.problems.length ? h('ul.link-problems', { role: 'note' }, view.problems.map((p) => h('li', p))) : null);
  const acts = editing ? h('div.row', { style: { gap: '6px' } }, h('button.btn.sm', { type: 'button', 'data-qa': 'link-edit', on: { click: () => openLinkForm({ panel, subs, view }) } }, 'Edit'))
    : h('p.xs.muted', { 'data-qa': 'link-readonly' }, state.draft ? 'Switch to Edit to refine this link.' : 'Open a draft to refine.');
  panel.open(head(view, subs, marks.markOf(`link:${view.id}`)), static_, editing ? [body, err] : null, acts);
  if (!editing) { fill(body); }
  try { suggestions = (await api.abstractLink(state.env, view.id)).suggestions ?? []; } catch { suggestions = []; }
  if (editing) await paint();
}
