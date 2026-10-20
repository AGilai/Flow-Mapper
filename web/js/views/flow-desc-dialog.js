// "Generate…": Flow-Mapper does not call an AI. The dialog hands over two ready-to-copy prompts (a switch picks one) for any AI tool
// that has the Flow-Mapper MCP server connected: the whole flow with all its services, or a single service.

import { h, toast } from '../dom.js';
import { icon } from '../icons.js';
import { flowPrompt, servicePrompt } from '../../core/description.js';

/** Copy with the clipboard API; without it (or when it refuses) select the text so Ctrl+C works. Returns true if copied. */
export async function copyText(text, pre) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  const range = document.createRange(); range.selectNodeContents(pre);
  const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
  return false;
}

/** openGenerate({ env, root: {service, ingress}, services: [names], callee?, onClose }) */
export function openGenerate({ env, root, services, callee, onClose }) {
  const opener = document.activeElement;
  const target = { env, ...root };
  const names = services?.length ? services : [root.service];
  let svc = callee && names.includes(callee.split(':')[0]) ? callee.split(':')[0] : names.includes(root.service) ? (names.find((n) => n !== root.service) ?? root.service) : names[0];

  let mode = 'flow'; // 'flow' | 'service'
  const text = () => (mode === 'flow' ? flowPrompt(target) : servicePrompt({ ...target, callee: svc }));
  const pre = h('pre.prompt', { tabindex: 0, 'aria-label': 'Prompt to copy' }, text());
  const pick = h('select.select', { 'aria-label': 'Service', hidden: true, on: { change: (e) => { svc = e.target.value; pre.textContent = text(); } } },
    names.map((n) => h('option', { value: n, selected: n === svc }, n)));
  const seg = h('div.seg', { role: 'group', 'aria-label': 'What to describe' }, [['flow', 'Whole flow'], ['service', 'One service']].map(([id, label]) =>
    h('button', { 'aria-pressed': String(id === mode), 'data-mode': id, on: { click: () => { mode = id; seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode))); pick.hidden = mode === 'flow'; pre.textContent = text(); } } }, label)));
  const copy = h('button.btn.sm', { on: { click: async () => {
    const ok = await copyText(pre.textContent, pre);
    toast(ok ? 'Prompt copied' : 'Could not use the clipboard. The prompt is selected: press Ctrl+C.');
    copy.textContent = ok ? 'Copied' : 'Copy prompt'; setTimeout(() => { copy.textContent = 'Copy prompt'; }, 1800);
  } } }, 'Copy prompt');

  const close = () => { document.removeEventListener('keydown', onKey, true); scrim.remove(); opener?.focus?.(); onClose?.(); };
  const x = h('button.btn.sm.ghost', { 'aria-label': 'Close', on: { click: close } }, icon('close'));
  const done = h('button.btn.primary', { on: { click: close } }, 'Done');
  const dlg = h('div.dlg', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Generate a description' },
    h('header', h('h3', 'Generate a description with your AI tool'), x),
    h('div.dlg-b',
      h('p.muted', 'Flow-Mapper does not call an AI itself. Copy a prompt and paste it into an AI tool that has the ', h('b', 'Flow-Mapper MCP server'), ' connected (Claude Code, Cursor, and so on). The tool reads the flow through MCP and saves the text back.'),
      h('div.dlg-row', h('b', 'Env'), h('span.mono', env), h('b', 'Flow'), h('span.mono', `${root.service} · ${root.ingress}`)),
      h('div.dlg-h', seg, pick, h('span.grow'), copy), pre),
    h('div.dlg-f', h('span.muted.xs', 'Writes only the AI description. The Human note is never touched.'), h('span.grow'), done));
  const scrim = h('div.scrim', { on: { mousedown: (e) => { if (e.target === scrim) close(); } } }, dlg);

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...dlg.querySelectorAll('button, select, [tabindex="0"]')].filter((n) => !n.disabled && !n.hidden);
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);
  x.focus();
  return { close };
}
