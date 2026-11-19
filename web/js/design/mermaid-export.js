// The Export items of a flow (frame 14a, 0.27.4; in the toolbar's ⋯ menu since frame 28): "Copy Mermaid" and "Download .mmd". It exports the open flow's full trace as `sequenceDiagram`
// text, in every environment (sealed ones and the static preview too). The text comes from the same code as the REST route and `export_mermaid`.

import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { orderStored } from '../views/flow-prefs.js';

/** A file name from a flow's name: `Agent connects to POP` -> `agent-connects-to-pop.mmd`. */
export const fileName = (name) => `${String(name || 'flow').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'flow'}.mmd`;

async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* the textarea way */ }
  const ta = h('textarea', { value: text, style: { position: 'fixed', opacity: '0' } });
  document.body.append(ta); ta.select();
  let ok = false; try { ok = document.execCommand('copy'); } catch { /* refused */ }
  ta.remove();
  return ok;
}

function download(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = h('a', { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** The two export items of one flow (Copy Mermaid, Download .mmd) as context-menu items; { service, ingress } is its entry point; `name` its display name (for the file). */
export function exportItems({ service, ingress, name, env = state.env, view = null }) { // view(): the tab's scenario (detail, choose, open): the export is the view the tab shows (0.38.0) // env: the flow's own (a tab of another env exports its own)
  const get = async () => { try { return await api.mermaid(env, service, ingress, { ...(view?.() ?? {}), ...(orderStored() === 'calls' ? { order: 'calls' } : {}) }); } catch (e) { toast(`Could not export: ${e.message}`); return null; } };
  const file = fileName(name || ingress);
  return [
    { label: 'Copy Mermaid', icon: 'copy', hint: 'sequenceDiagram', onSelect: async () => { const t = await get(); if (t != null) toast((await copy(t)) ? 'Mermaid copied' : 'Could not use the clipboard: use Download .mmd'); } },
    { label: 'Download .mmd', icon: 'upload', hint: file, onSelect: async () => { const t = await get(); if (t != null) { download(t, file); toast(`Downloaded ${file}`); } } },
  ];
}
