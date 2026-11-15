// What a document adds to the comment editor's toolbar (frame 20b, then 28d-f): a Heading menu (Paragraph, Heading 1-3), code and Mermaid blocks,
// "Link to" (service, flow, call / step chips), "Callout" (Key step, Watch, Risk with a step picker) and, in a flow doc, the step chip ("step #").
// All keep the editor's selection like the other buttons (mousedown does not take focus). The "/" menu (slash.js) offers the same commands.

import { h } from '../dom.js';
import { parseStepRef, stepRefText } from '../../core/notes.js';
import { CALLOUT_LABEL } from '../../core/callouts.js';
import { commands, insertCallout, calloutAt, loadTargets, refHtml } from './insert.js';
import { attachSlash } from './slash.js';

const BLOCKS = [['p', 'Paragraph'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3']];

/** The HTML of a step chip as the editor holds it: not editable text, written back as `<span data-step>`. */
const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
export const chipHtml = (ref, keys = {}) => `<span data-step="${ref.to > ref.from ? `${ref.from}-${ref.to}` : ref.from}"${keys.key ? ` data-key="${attr(keys.key)}"` : ''}${keys.keyTo ? ` data-key-to="${attr(keys.keyTo)}"` : ''} contenteditable="false">${stepRefText(ref)}</span>&nbsp;`; // 0.38.0: the step's key too (the chip follows it across scenarios)

/** notesTools(ed, tb, { kind, env, stepNow() -> { n } | null, keyOf(n) }) -> { update(), dispose() }: adds the buttons to the toolbar `tb` (createToolbar) of the editor `ed`. */
export function notesTools(ed, tb, { kind = 'flow', env, stepNow = () => null, keyOf = () => null } = {}) {
  let menu = null;
  const close = () => { menu?.remove(); menu = null; for (const b of btns) b.setAttribute('aria-expanded', 'false'); };
  const place = (m, b) => { const bar = tb.el; m.style.top = `${bar.offsetTop + bar.offsetHeight + 2}px`; bar.parentElement.append(m); m.style.left = `${Math.max(0, Math.min(b.offsetLeft + bar.offsetLeft, bar.parentElement.clientWidth - m.offsetWidth - 4))}px`; };
  const open = (b, make) => {
    if (menu) { const same = menu.dataset.for === b.dataset.qa; close(); if (same) return; }
    menu = make(); menu.dataset.for = b.dataset.qa; b.setAttribute('aria-expanded', 'true'); place(menu, b);
    menu.querySelector('input, button')?.focus();
    menu.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); b.focus(); } });
  };
  const keep = (e) => e.preventDefault();
  const tbb = (qa, label, text, extra = {}) => h('button.tbb.wide', { type: 'button', title: label, 'aria-label': label, tabindex: -1, 'data-qa': qa, on: { mousedown: keep }, ...extra }, text);
  const menuBtn = (qa, label, text, make) => { const b = tbb(qa, label, text, { 'aria-haspopup': 'true', 'aria-expanded': 'false' }); b.addEventListener('click', () => open(b, make)); return b; };

  const head = menuBtn('nt-heading', 'Paragraph style', 'Paragraph ▾', headMenu);
  const cmds = commands(ed, { kind, ask: (name, arg) => { const b = { link: linkBtn, callout: calloutBtn, step: stepBtn }[name]; if (name === 'callout' && arg) pending = arg; if (b) open(b, { link: linkMenu, callout: calloutMenu, step: stepMenu }[name]); } });
  const run = (id) => () => { close(); cmds.find((c) => c.id === id)?.run(); update(); };
  let pending = null; // the kind a "/callout" asked for
  const codeBtn = tbb('nt-code', 'Code block', '{ }', { on: { mousedown: keep, click: run('code') } });
  const mmBtn = tbb('nt-mermaid', 'Mermaid diagram block', 'Mermaid', { on: { mousedown: keep, click: run('mermaid') } });
  const linkBtn = menuBtn('nt-link', 'Link to a service, flow or call', 'Link to ▾', linkMenu);
  const calloutBtn = menuBtn('nt-callout', 'Callout: Key step, Watch or Risk', 'Callout ▾', calloutMenu);
  const stepBtn = kind === 'flow' ? menuBtn('nt-step-btn', 'Insert a step chip', 'step #', stepMenu) : null;
  const btns = [head, linkBtn, calloutBtn, stepBtn].filter(Boolean);

  function headMenu() {
    const cur = current();
    return h('div.omenu.nt-hm', { role: 'menu', 'aria-label': 'Paragraph style' }, BLOCKS.map(([t, label]) => h('button.om', { type: 'button', role: 'menuitemradio', 'aria-checked': String(t === cur), on: { mousedown: keep, click: () => { close(); ed.exec(() => document.execCommand('formatBlock', false, t)); update(); } } }, h('span.nt-mk', t === cur ? '✓' : ''), label)));
  }
  function stepMenu() {
    const n = stepNow()?.n ?? 1, a = h('input.input', { type: 'number', min: 1, max: 9999, value: n, 'aria-label': 'Step number', 'data-qa': 'nt-step-from' }), b = h('input.input', { type: 'number', min: 1, max: 9999, placeholder: 'to (optional)', 'aria-label': 'Last step of a range', 'data-qa': 'nt-step-to' });
    const err = h('div.cm-err', { role: 'alert' });
    const apply = () => {
      const ref = parseStepRef(b.value ? `${a.value}-${b.value}` : a.value);
      if (!ref) { err.textContent = 'Give a step number (and a later one for a range).'; return; }
      close(); ed.exec(() => document.execCommand('insertHTML', false, chipHtml(ref, { key: keyOf(ref.from), keyTo: ref.to > ref.from ? keyOf(ref.to) : null })));
    };
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } };
    a.addEventListener('keydown', onKey); b.addEventListener('keydown', onKey);
    return h('div.cmenu.nt-sm', { role: 'group', 'aria-label': 'Step chip' }, h('h5', 'Link a step'), h('div.nt-sr', a, h('span', '–'), b), err, h('div.lk-b', h('button.btn.sm.primary', { type: 'button', on: { click: apply } }, 'Insert')));
  }
  function calloutMenu() {
    const at = calloutAt(ed), k0 = pending ?? at?.dataset.callout ?? 'key'; pending = null;
    let k = k0;
    const n = at?.dataset.step ?? (kind === 'flow' ? stepNow()?.n ?? 1 : ''), step = h('input.input', { type: 'number', min: 1, max: 9999, value: n, placeholder: kind === 'flow' ? 'step' : 'step (optional)', 'aria-label': 'Step of the callout', 'data-qa': 'nt-co-step-in' });
    const kinds = ['key', 'watch', 'risk'].map((x) => h('button.om', { type: 'button', role: 'menuitemradio', 'aria-checked': String(x === k), 'data-kind': x, on: { mousedown: keep, click: () => { k = x; kinds.forEach((b) => { b.setAttribute('aria-checked', String(b.dataset.kind === k)); b.firstChild.textContent = b.dataset.kind === k ? '✓' : ''; }); } } }, h('span.nt-mk', x === k ? '✓' : ''), CALLOUT_LABEL[x]));
    const apply = () => { const s = Number(step.value) || 0; close(); insertCallout(ed, k, s > 0 && s <= 9999 ? s : null, s > 0 ? keyOf(s) : null); update(); };
    step.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); apply(); } });
    return h('div.omenu.nt-cm', { role: 'group', 'aria-label': 'Callout' }, h('h5', at ? 'Change this callout' : 'Callout'), kinds, h('div.nt-sr.nt-cs', h('span', 'Step'), step), h('div.lk-b', h('button.btn.sm.primary', { type: 'button', 'data-qa': 'nt-co-apply', on: { click: apply } }, at ? 'Update' : 'Insert')));
  }
  function linkMenu() {
    const q = h('input.input', { type: 'search', placeholder: 'Find a service or flow…', 'aria-label': 'Find a service or flow', 'data-qa': 'nt-link-q' }), list = h('div.nt-lk-l', { role: 'listbox' });
    let data = null;
    const put = (value, label) => { close(); ed.exec(() => document.execCommand('insertHTML', false, refHtml(value, label))); };
    const rows = () => {
      if (!data) { list.replaceChildren(h('div.cm-hint', 'Loading…')); return; }
      const t = q.value.trim().toLowerCase(), has = (...s) => !t || s.join(' ').toLowerCase().includes(t);
      const sv = data.services.filter((s) => has(s)).slice(0, 12).map((s) => h('button.om', { type: 'button', role: 'option', 'data-qa': 'nt-link-svc', on: { mousedown: keep, click: () => put(`svc:${s}`, s) } }, h('i.nt-dot'), h('b', s), h('small', 'service')));
      const fl = data.flows.filter((f) => has(f.service, f.id, f.name)).slice(0, 14).map((f) => {
        const n = h('input.input.nt-lk-n', { type: 'number', min: 1, max: 9999, placeholder: 'step', 'aria-label': `Step of ${f.id} (optional)`, on: { click: (e) => e.stopPropagation(), keydown: (e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); go(); } } } });
        const go = () => { const s = Number(n.value); put(s > 0 ? `step:${f.service}/${f.id}#${s}` : `flow:${f.service}/${f.id}`, s > 0 ? `step ${s} of ${f.name || f.id}` : f.name || `${f.service} · ${f.id}`); };
        return h('div.om.nt-lk-f', { role: 'option', tabindex: 0, 'data-qa': 'nt-link-flow', on: { mousedown: (e) => { if (e.target !== n) e.preventDefault(); }, click: go, keydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); go(); } } } }, h('b', f.name || f.id), h('small', f.name ? `${f.service} · ${f.id}` : f.service), n);
      });
      list.replaceChildren(...(sv.length || fl.length ? [...sv, ...fl] : [h('div.cm-hint', 'Nothing matches.')]));
    };
    q.addEventListener('input', rows);
    loadTargets(env).then((d) => { data = d; rows(); });
    rows();
    return h('div.cmenu.nt-lm', { role: 'group', 'aria-label': 'Link to' }, h('h5', 'Link to'), q, list, h('div.cm-hint', 'Type a step number next to a flow to link that call.'));
  }
  const current = () => { let v = ''; try { v = String(document.queryCommandValue('formatBlock') || '').toLowerCase().replace(/[<>]/g, ''); } catch { /* none */ } return ['h1', 'h2', 'h3'].includes(v) ? v : 'p'; };
  function update() { head.firstChild.textContent = `${BLOCKS.find(([t]) => t === current())[1]} ▾`; calloutBtn.classList.toggle('on', !!calloutAt(ed)); }
  const first = tb.el.firstChild, more = tb.el.querySelector('.tb-more');
  tb.el.insertBefore(head, first); tb.el.insertBefore(h('span.tbsep', { 'aria-hidden': 'true' }), first);
  for (const b of [codeBtn, mmBtn, linkBtn, calloutBtn, stepBtn]) if (b) tb.el.insertBefore(b, more);
  const slash = attachSlash(ed, cmds.map((c) => ({ ...c, run: () => { close(); c.run(); update(); } })));
  const onDown = (e) => { if (menu && !menu.contains(e.target) && !btns.some((b) => b.contains(e.target))) close(); };
  document.addEventListener('mousedown', onDown);
  return { update, dispose: () => { document.removeEventListener('mousedown', onDown); slash.dispose(); close(); } };
}
