// Text colour for the comment editor (0.27.0), our own code: a colour is a palette class on a span (cc-coral ... cc-violet), never a hex.
// A selection is painted text node by text node (so lists, tables and bold keep their shape); a collapsed caret gets an empty span to type in
// (a zero-width space holds it; the editor drops empty spans and the space when it exports).

export const COLOURS = [
  { cls: null, name: 'Default' }, { cls: 'cc-coral', name: 'coral' }, { cls: 'cc-ochre', name: 'ochre' }, { cls: 'cc-sage', name: 'sage' },
  { cls: 'cc-cyan', name: 'cyan' }, { cls: 'cc-sky', name: 'sky' }, { cls: 'cc-violet', name: 'violet' },
];
const SPAN = 'span[class^="cc-"]';
const ZW = '​';

/** The colour class at a node (null: default). */
export function colourAt(area, node) {
  const s = node?.nodeType === 1 ? node : node?.parentElement;
  const c = s?.closest?.(SPAN);
  return c && area.contains(c) ? c.className : null;
}

function textParts(range) {
  const root = range.commonAncestorContainer;
  const nodes = [];
  if (root.nodeType === 3) nodes.push(root);
  else { const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (range.intersectsNode(n)) nodes.push(n); }
  const out = [];
  for (const n of nodes) {
    const s = n === range.startContainer ? range.startOffset : 0, e = n === range.endContainer ? range.endOffset : n.length;
    if (s >= e) continue;
    let t = n;
    if (e < t.length) t.splitText(e);
    if (s > 0) t = t.splitText(s);
    out.push(t);
  }
  return out;
}

/** Make `S` hold only the chain down to `t`: what comes before and after goes to copies of S on either side. */
function isolate(S, t) {
  const side = (a, place) => { const f = a.extractContents(); if (!f.textContent) return; const c = S.cloneNode(false); c.append(f); S[place](c); };
  const b = document.createRange(); b.setStart(S, 0); b.setEndBefore(t); side(b, 'before');
  const a = document.createRange(); a.setStartAfter(t); a.setEnd(S, S.childNodes.length); side(a, 'after');
}
const unwrap = (S) => { S.replaceWith(...S.childNodes); };

function paint(area, t, cls) {
  let S = t.parentElement?.closest(SPAN);
  if (S && !area.contains(S)) S = null;
  if (S) { isolate(S, t); if (cls) S.className = cls; else unwrap(S); } else if (cls) { const sp = document.createElement('span'); sp.className = cls; t.replaceWith(sp); sp.append(t); }
}

/** Colour the selection (cls null: back to the default colour). */
export function applyColour(area, range, cls) {
  if (!range) return;
  const s = getSelection();
  if (range.collapsed) { // the caret: what is typed next
    let S = range.startContainer.parentElement?.closest(SPAN);
    if (S && !area.contains(S)) S = null;
    if (S ? S.className === cls : !cls) return;
    const z = document.createTextNode(ZW);
    if (S) { const r = document.createRange(); r.setStart(range.startContainer, range.startOffset); r.setEnd(S, S.childNodes.length); const rest = S.cloneNode(false); rest.append(r.extractContents()); S.after(rest); }
    let at = z;
    if (cls) { at = document.createElement('span'); at.className = cls; at.append(z); }
    if (S) S.after(at); else range.insertNode(at);
    const r = document.createRange(); r.setStart(z, 1); r.collapse(true); s.removeAllRanges(); s.addRange(r);
    return;
  }
  const parts = textParts(range);
  parts.forEach((t) => paint(area, t, cls));
  if (parts.length) { const r = document.createRange(); r.setStart(parts[0], 0); r.setEnd(parts[parts.length - 1], parts[parts.length - 1].length); s.removeAllRanges(); s.addRange(r); }
}
