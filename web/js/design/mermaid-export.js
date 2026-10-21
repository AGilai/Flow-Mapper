// The Export menu on a flow's header (frame 14a, 0.27.2): "Copy Mermaid" and "Download .mmd". It exports the open flow's full trace as `sequenceDiagram`
// text, in every environment (sealed ones and the static preview too). The text comes from the same code as the REST route and `export_mermaid`.

import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { openMenu } from '../components/context-menu.js';

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

/** The export button of one flow: { service, ingress } is its entry point; `name` its display name (for the file). */
export function exportButton({ service, ingress, name }) {
  const get = async () => { try { return await api.mermaid(state.env, service, ingress); } catch (e) { toast(`Could not export: ${e.message}`); return null; } };
  const file = fileName(name || ingress);
  return h('button.btn.sm.mm-export', { type: 'button', 'data-qa': 'mermaid-export', 'aria-haspopup': 'menu', title: 'Export this flow as a Mermaid sequence diagram',
    on: { click: (e) => {
      e.preventDefault(); e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect(), anchor = e.currentTarget;
      const back = (ev) => { if (ev.key === 'Escape') setTimeout(() => anchor.focus()); removeEventListener('keydown', back, true); };
      addEventListener('keydown', back, true); setTimeout(() => removeEventListener('keydown', back, true), 20000);
      openMenu(r.right - 240, r.bottom + 4, 'Export', [
        { label: 'Copy Mermaid', hint: 'sequenceDiagram', onSelect: async () => { const t = await get(); if (t != null) toast((await copy(t)) ? 'Mermaid copied' : 'Could not use the clipboard: use Download .mmd'); } },
        { label: 'Download .mmd', hint: file, onSelect: async () => { const t = await get(); if (t != null) { download(t, file); toast(`Downloaded ${file}`); } } },
      ]);
    } } }, 'Export', h('span.dz-caret', '▾'));
}

/** "Import Mermaid…" on the flow header while Edit is on. */
export const importButton = () => h('button.btn.sm', { type: 'button', 'data-qa': 'mermaid-import-open', title: 'Import a Mermaid sequence diagram into this draft',
  on: { click: async (e) => { e.preventDefault(); e.stopPropagation(); (await import('./mermaid-dialog.js')).openMermaidImport(); } } }, 'Import Mermaid…');
