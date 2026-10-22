// Import Mermaid (frame 14, 0.27.4): a three-step dialog into the open draft: 1 paste (or a .mmd file), 2 match (every participant has a select
// and a chip saying how it was matched; what creates something is amber and counted), 3 preview (counts, warnings). The draft is touched only
// by the last button. The parse summary of step 1 runs in the browser; matching and the preview ask the server (the same code the API runs).

import { h, fill, toast, debounce } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { go, href } from '../router.js';
import { icon } from '../icons.js';
import { parseMermaid, summarize } from '../../core/mermaid-parse.js';
import { me } from './who.js';
import { afterEdit } from './after-edit.js';
import { invalidateMarks } from './marks-store.js';
import { setLastImport } from './mermaid-undo.js';
import { barText, chipOf, choiceOf, copiedNames, createdNames, hintOf, optionsFor, previewWarnings, tiles, valueOf, afterText } from './mermaid-pure.js';

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
const groupsOf = () => state.envMeta.find((m) => m.name === state.env)?.groups ?? [];

/** Open the dialog for the open draft. `text`: what to start with. */
export function openMermaidImport({ text = '' } = {}) {
  const opener = document.activeElement;
  const S = { step: 1, text, rows: [], choices: {}, components: [], source: null, group: groupsOf().length === 1 ? groupsOf()[0].key : '', preview: null, busy: false, error: '' };
  const groupLabel = () => groupsOf().find((g) => g.key === S.group)?.label ?? '';
  const dlg = h('dialog.mm-dlg', { 'aria-labelledby': 'mm-title', 'data-qa': 'mermaid-dialog', on: { cancel: (e) => { e.preventDefault(); close(); } } });
  const close = () => { dlg.close(); dlg.remove(); opener?.focus?.(); };
  const steps = ['Paste', 'Match', 'Preview'];

  const head = () => h('div.mm-dh', h('h3#mm-title', 'Import Mermaid into draft ', h('span.mono', state.draft)),
    h('ol.mm-steps', steps.map((t, i) => h('li', { class: S.step === i + 1 ? 'on' : S.step > i + 1 ? 'done' : '', 'aria-current': S.step === i + 1 ? 'step' : null }, `${i + 1} ${t}`))),
    h('button.mm-x', { type: 'button', 'aria-label': 'Close', title: 'Close', on: { click: close } }, icon('close')));
  const err = () => (S.error ? h('div.error-box', { role: 'alert', 'data-qa': 'mermaid-error' }, S.error) : null);

  // ---- step 1: paste
  function paste() {
    const area = h('textarea.mm-text', { rows: 13, value: S.text, spellcheck: false, placeholder: 'sequenceDiagram\n  participant A as pop-edge\n  A->>B: POST /token', 'aria-label': 'Mermaid sequence diagram', 'data-qa': 'mermaid-text' });
    const sum = h('div.mm-sum', { 'aria-live': 'polite' }), next = h('button.btn.primary', { type: 'button', 'data-qa': 'mermaid-next', on: { click: toMatch } }, 'Match participants');
    const file = h('input', { type: 'file', accept: '.mmd,.mermaid,.txt,text/plain', hidden: true, 'data-qa': 'mermaid-file', on: { change: async (e) => { const f = e.target.files[0]; if (f) { area.value = await f.text(); update(); } } } });
    const mark = (line) => { const lines = area.value.split('\n'); const at = lines.slice(0, line - 1).join('\n').length + (line > 1 ? 1 : 0); area.focus(); area.setSelectionRange(at, at + (lines[line - 1] ?? '').length); };
    function update() {
      S.text = area.value;
      const p = parseMermaid(S.text), c = summarize(p);
      next.disabled = !c.messages || S.busy;
      fill(sum, !S.text.trim() ? h('span.muted', 'Paste a sequence diagram or choose a .mmd file.') : [
        h('span.ok', c.messages ? 'Parsed.' : 'Nothing to import yet.'),
        h('span', `${plural(c.participants, 'participant')}${c.actors ? ` (${c.actors} actor${c.actors === 1 ? '' : 's'})` : ''}, ${plural(c.messages, 'message')}, ${plural(c.notes, 'note')}`),
        c.warnings ? h('span.w', ` · ${plural(c.warnings, 'warning')}`) : null,
        c.warnings ? h('ul.mm-warns.mm-lines', p.warnings.map((w) => h('li', h('button.mm-line', { type: 'button', title: 'Select this line', on: { click: () => mark(w.line) } }, `line ${w.line}`), ` ${w.text}`))) : null]);
    }
    const later = debounce(update, 250);   // a big paste is parsed once, not on every key
    area.addEventListener('input', () => { S.text = area.value; later(); });
    setTimeout(update);
    return { body: [h('div.mm-pick', h('button.btn', { type: 'button', on: { click: () => file.click() } }, icon('upload'), 'Choose a .mmd file'), file, h('span.mm-or', 'or paste the text')), area, sum, err()],
      foot: [h('span.small.muted', 'Nothing is written to the draft until the last step.'), h('div.r', h('button.btn', { type: 'button', on: { click: close } }, 'Cancel'), next)] };
  }

  async function ask(matches) {
    S.busy = true; S.error = ''; paint();
    try { return await api.mermaidPreview(state.env, state.draft, { text: S.text, ...(matches ? { matches, groupPath: S.group || undefined } : {}) }); }
    catch (e) { S.error = e.message; return null; } finally { S.busy = false; }
  }
  async function toMatch() {
    const p = await ask(null);
    if (p) { S.rows = p.participants; S.choices = { ...p.matches }; S.components = p.components; S.source = p.source; S.step = 2; }
    paint();
  }
  async function toPreview() {
    const p = await ask(S.choices);
    if (p) { S.preview = p; S.step = 3; }
    paint();
  }

  // ---- step 2: match
  function match() {
    const bar = h('div.mm-wbar', { 'data-qa': 'mermaid-bar' }), table = h('div.mm-rows', { role: 'table', 'aria-label': 'Participants and the components they match' });
    const grp = groupsOf().length ? h('label.sub', 'Subsystem for new components ', h('select.select', { 'data-qa': 'mermaid-group', on: { change: (e) => { S.group = e.target.value; drawBar(); } } },
      [h('option', { value: '', selected: !S.group }, '(none)'), ...groupsOf().map((g) => h('option', { value: g.key, selected: g.key === S.group }, g.label))])) : null;
    function drawBar() {
      const names = createdNames(S.rows, S.choices, S.components), text = barText(names, S.group ? groupLabel() : '');
      bar.hidden = !text && !grp; bar.classList.toggle('calm', !text);
      fill(bar, text ? icon('warn', 'mm-ic') : null, h('b', text ?? 'No new components will be created'), grp);
    }
    function drawRow(r) {
      const c = S.choices[r.id], [chipText, chipCls] = chipOf({ ...r, sourceName: S.source }, c), hint = hintOf(r, c, S.source);
      const warn = c && 'create' in c && r.how !== 'infra';
      const sel = h('select.mm-sel', { class: warn ? 'warn' : '', 'aria-label': `Component for ${r.label}`, 'data-qa': `mermaid-select-${r.id}`, 'data-id': r.id,
        on: { change: (e) => { S.choices[r.id] = choiceOf(e.target.value, r); drawTable(r.id); drawBar(); } } },
        optionsFor(r, S.components, S.source).map((o) => h('option', { value: o.value, selected: o.value === valueOf(c), title: o.note ?? '' }, o.label)));
      return h('div.mm-row', { role: 'row', class: warn ? 'warnr' : '' },
        h('div.pn', { role: 'cell' }, r.label, h('small', r.actor ? 'actor' : `participant ${r.id}`)), h('div.ar', { 'aria-hidden': 'true' }, '→'),
        h('div.sel-c', { role: 'cell' }, warn ? icon('warn', 'mm-ic') : null, sel), h('div', { role: 'cell' }, h('span.mm-chip', { class: chipCls }, chipText)),
        hint ? h('div.hint', hint) : null);
    }
    function drawTable(focusId) {
      fill(table, h('div.mm-row.h', { role: 'row' }, h('div', 'Participant (as written)'), h('div'), h('div', 'Component'), h('div', 'Matched by')), S.rows.map(drawRow));
      if (focusId != null) [...table.querySelectorAll('select')].find((x) => x.dataset.id === focusId)?.focus();
    }
    drawTable();
    drawBar();
    return { body: [bar, table, h('p.mm-ord', h('b', 'Match order: '), '1 exact name · 2 alias equal to a name · 3 normalized (case, - _ space, -svc / service suffix) · 4 close spelling (up to 2 edits, only if unique) · 5 same name in the source environment. Only 1 to 4 pre-fill a component; a name found only in the source never imports by itself.'), err()],
      foot: [h('button.btn', { type: 'button', on: { click: () => { S.step = 1; S.error = ''; paint(); } } }, 'Back'), h('span.small.muted', 'Changing a select updates the warning above.'),
        h('div.r', h('button.btn', { type: 'button', on: { click: close } }, 'Cancel'), h('button.btn.primary', { type: 'button', disabled: S.busy, 'data-qa': 'mermaid-preview', on: { click: toPreview } }, 'Preview'))] };
  }

  /** What the text holds beyond calls (0.33.1): frames, changed steps, links. */
  const constructs = (x) => { const l = [x?.groups && plural(x.groups, 'frame'), x?.marked && `${x.marked} changed ${x.marked === 1 ? 'step' : 'steps'}`, x?.links && plural(x.links, 'link')].filter(Boolean); return l.length ? ` Also read: ${l.join(', ')}.` : ''; };

  // ---- step 3: preview, then import
  function previewStep() {
    const p = S.preview, ws = previewWarnings(p, S.rows, S.choices, S.group ? groupLabel() : '');
    const notes = p.counts.notes;
    return { body: [h('div.mm-counts', { 'data-qa': 'mermaid-counts' }, tiles(p).map(([a, b]) => h('span', { class: a === 'Flow name' ? 'nm' : '' }, a, h('small', b)))),
      h('p.small.muted', `${plural(notes, 'step description')} from notes and labels.${constructs(p.summary)} Already in the design and reused, not duplicated: ${p.counts.reused}.${p.ops === 0 ? ' Nothing new: importing adds nothing.' : ''}`),
      ws.length ? h('div', h('h4.mm-wh', `Warnings (${ws.length})`), h('ul.mm-warns', ws.map((w) => h('li', icon('warn', 'mm-ic'), h('span', w.line ? `Line ${w.line}: ${w.text}` : w.text))))) : null, err()],
    foot: [h('button.btn', { type: 'button', on: { click: () => { S.step = 2; S.error = ''; paint(); } } }, 'Back'), h('span.small.muted', 'Nothing is applied until the draft is applied. Review changes shows it first.'),
      h('div.r', h('button.btn.primary', { type: 'button', disabled: S.busy || !p.flow, 'data-qa': 'mermaid-import', on: { click: run } }, S.busy ? 'Importing…' : `Import into draft ${state.draft}`))] };
  }
  async function run() {
    S.busy = true; S.error = ''; paint();
    try {
      const out = await api.mermaidImport(state.env, state.draft, { text: S.text, matches: S.choices, groupPath: S.group || undefined }, me());
      close();
      if (out.batch) setLastImport({ draft: state.draft, batch: out.batch, flow: `${out.flow.service}/${out.flow.ingress}`, text: afterText(out, S.group ? groupLabel() : '') });
      else toast('Nothing new: everything in the diagram is already in the design');
      const to = { env: state.env, draft: state.draft, mode: 'edit', tabs: `${out.flow.service}/${out.flow.ingress}` };
      if (location.hash === href('/flows', to)) afterEdit();   // already there: draw again
      else { invalidateMarks(); go('/flows', to); }           // the new hash draws the page once
    } catch (e) { S.busy = false; S.error = e.message; paint(); }
  }

  function paint() {
    const v = S.step === 1 ? paste() : S.step === 2 ? match() : previewStep();
    fill(dlg, head(), h('div.mm-db', v.body), h('div.mm-df', v.foot));
    if (!dlg.open) return;
    const first = dlg.querySelector('.mm-text, .mm-sel, [data-qa=mermaid-import]');
    if (S.step !== 1 || !S.text) first?.focus();
  }
  document.body.append(dlg);
  paint();
  dlg.showModal();
  dlg.querySelector('.mm-text')?.focus();
  return dlg;
}
