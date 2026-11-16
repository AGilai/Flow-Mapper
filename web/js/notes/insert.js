// The blocks a document can insert (Unreleased, frame 28d-f): headings, lists, a table, a code block, a Mermaid block, a callout tied to a step, and
// reference chips (service, flow, call / step) that link into the app. One set of commands serves the "/" menu (slash.js) and the toolbar buttons
// (edit-toolbar.js). Blocks are put in by hand (after the block the caret is in) so the result does not depend on how execCommand treats a div.

import { api } from '../api.js';
import { insertTable } from '../comments/rte-table.js';

export const MERMAID_SAMPLE = 'sequenceDiagram\n  participant A as client\n  participant B as service\n  A->>B: request\n  B-->>A: response';
const attr = (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** Put `node` after the top-level block the caret is in (in its place when that block is empty), the caret inside it. */
export function putBlock(ed, range, node, caret = node) {
  const area = ed.el;
  let b = range?.startContainer ?? null;
  const at = range?.startContainer, li = (at?.nodeType === 1 ? at : at?.parentElement)?.closest?.('li');
  while (b && b.parentNode !== area) b = b.parentNode;
  if (li && b && /^(UL|OL)$/.test(b.nodeName) && !li.textContent.trim()) li.remove(); // the empty item the "/" was typed in goes
  if (!b) area.append(node);
  else if (!b.textContent.trim() && !b.querySelector('img, table, pre')) b.replaceWith(node); else b.after(node);
  if (!node.nextSibling || node.nextSibling.nodeType !== 1) { const p = document.createElement('p'); p.append(document.createElement('br')); node.after(p); } // somewhere to go on after it
  const r = document.createRange(); r.selectNodeContents(caret); r.collapse(true);
  const s = getSelection(); s.removeAllRanges(); s.addRange(r);
}

/** The callout the caret is in, or null. */
export const calloutAt = (ed) => { const r = ed.range(); const n = r?.startContainer; return (n?.nodeType === 1 ? n : n?.parentElement)?.closest?.('div[data-callout]') ?? null; };

/** The commands: id -> { label, hint, run(), kinds } (kinds: which documents offer it). `ask(name)` opens a toolbar menu (link, callout, step). */
export function commands(ed, { kind, ask }) {
  // A heading is never put inside a list item (formatBlock would wrap the list in the heading): on the empty item the "/" was typed in it replaces the item, on a filled one it does nothing.
  const fmt = (tag) => () => ed.exec((r) => {
    const at = r?.startContainer, li = (at?.nodeType === 1 ? at : at?.parentElement)?.closest?.('li');
    if (!li) { document.execCommand('formatBlock', false, tag); return; }
    if (li.textContent.trim()) return;
    const hd = document.createElement(tag); hd.append(document.createElement('br')); putBlock(ed, r, hd);
  });
  const list = (cmd) => () => ed.exec(() => document.execCommand(cmd));
  const code = () => ed.exec((r) => { const pre = document.createElement('pre'), c = document.createElement('code'); c.append(document.createElement('br')); pre.append(c); putBlock(ed, r, pre, c); });
  const mermaid = () => ed.exec((r) => { const pre = document.createElement('pre'); pre.setAttribute('data-mermaid', '1'); pre.textContent = MERMAID_SAMPLE; putBlock(ed, r, pre); });
  const callout = (k) => () => (calloutAt(ed) ? ed.exec(() => calloutAt(ed)?.setAttribute('data-callout', k)) : ask('callout', k));
  const all = [
    ['h1', 'Heading 1', 'Page title', fmt('h1')], ['h2', 'Heading 2', 'Section', fmt('h2')], ['h3', 'Heading 3', 'Subsection', fmt('h3')],
    ['ul', 'Bulleted list', 'Nested with Tab', list('insertUnorderedList')], ['ol', 'Numbered list', '', list('insertOrderedList')],
    ['table', 'Table', '3 by 3', () => ed.exec((r) => insertTable(ed.el, r))],
    ['code', 'Code block', 'Monospaced', code], ...(kind === 'call' ? [] : [['mermaid', 'Mermaid diagram', 'sequenceDiagram source', mermaid]]),
    ['key', 'Callout: Key step', 'Tie a point to a step', callout('key')], ['watch', 'Callout: Watch', 'Something to look at', callout('watch')], ['risk', 'Callout: Risk', 'Something that can go wrong', callout('risk')],
    ['link', 'Link to a service or flow', 'A chip that opens it', () => ask('link')],
    ...(kind === 'flow' ? [['step', 'Step chip', 'Jump to a step', () => ask('step')]] : []),
  ];
  return all.map(([id, label, hint, run]) => ({ id, label, hint, run }));
}

/** The HTML of a callout block as the editor holds it: the sanitizer keeps `data-callout` and one `data-step`. */
export const calloutHtml = (k, step, key) => `<div data-callout="${k}"${step ? ` data-step="${step}"` : ''}${key ? ` data-key="${attr(key)}"` : ''}><p><br></p></div>`;

/** Insert a callout (kind, step) after the current block, or change the one the caret is in. */
export function insertCallout(ed, k, step, key) {
  ed.exec((r) => {
    const cur = calloutAt(ed);
    if (cur) { cur.setAttribute('data-callout', k); if (step) cur.setAttribute('data-step', String(step)); else cur.removeAttribute('data-step'); if (key) cur.setAttribute('data-key', key); else cur.removeAttribute('data-key'); return; }
    const box = document.createElement('div'); box.innerHTML = calloutHtml(k, step, key);
    const d = box.firstChild; putBlock(ed, r, d, d.firstChild);
  });
}

/** A reference chip as the editor holds it: not editable text, written back as `<span data-ref>`. */
export const refHtml = (value, label) => `<span data-ref="${attr(value)}" contenteditable="false">${attr(label)}</span>&nbsp;`;

let known = null; // { env, services: [name], flows: [{ service, id, name }] }
/** The services and entry points of the env, for the Link menu (loaded once per env). */
export async function loadTargets(env) {
  if (known?.env === env) return known;
  const [svcs, pts] = await Promise.all([api.services(env).catch(() => []), api.entryPoints(env).catch(() => [])]);
  known = { env, services: [...new Set(svcs.map((s) => s.name))].sort(), flows: pts.map((p) => ({ service: p.service, id: p.id, name: p.name || '' })).sort((a, b) => (a.service + a.id).localeCompare(b.service + b.id)) };
  return known;
}
