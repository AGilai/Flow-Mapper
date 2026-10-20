// "Generate…": Flow-Mapper does not call an AI. The dialog hands over two ready-to-copy prompts for any AI tool that has
// the Flow-Mapper MCP server connected: one for the whole flow with all its services, one for a single service.

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

  const copyBtn = (getText, getPre, label) => h('button.btn.sm', { on: { click: async (e) => {
    const ok = await copyText(getText(), getPre());
    toast(ok ? 'Prompt copied' : 'Could not use the clipboard. The prompt is selected: press Ctrl+C.');
    e.target.textContent = ok ? 'Copied' : label; setTimeout(() => { e.target.textContent = label; }, 1800);
  } } }, label);

  const pre1 = h('pre.prompt', { tabindex: 0, 'aria-label': 'Prompt for the whole flow' }, flowPrompt(target));
  const pre2 = h('pre.prompt', { tabindex: 0, 'aria-label': 'Prompt for one service' }, servicePrompt({ ...target, callee: svc }));
  const pick = h('select.select', { 'aria-label': 'Service', on: { change: (e) => { svc = e.target.value; pre2.textContent = servicePrompt({ ...target, callee: svc }); } } },
    names.map((n) => h('option', { value: n, selected: n === svc }, n)));

  const close = () => { document.removeEventListener('keydown', onKey, true); scrim.remove(); opener?.focus?.(); onClose?.(); };
  const x = h('button.btn.sm.ghost', { 'aria-label': 'Close', on: { click: close } }, icon('close'));
  const done = h('button.btn.primary', { on: { click: close } }, 'Done');
  const dlg = h('div.dlg', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Generate a description' },
    h('header', h('h3', 'Generate a description with your AI tool'), x),
    h('div.dlg-b',
      h('p.muted', 'Flow-Mapper does not call an AI itself. Copy a prompt and paste it into an AI tool that has the ', h('b', 'Flow-Mapper MCP server'), ' connected (Claude Code, Cursor, and so on). The tool reads the flow through MCP and saves the text back.'),
      h('div.dlg-row', h('b', 'Env'), h('span.mono', env), h('b', 'Flow'), h('span.mono', `${root.service} · ${root.ingress}`)),
      h('section.dlg-sec', h('div.dlg-h', h('h4', 'Prompt 1 · The whole flow, with all its services'), h('span.grow'), copyBtn(() => pre1.textContent, () => pre1, 'Copy prompt 1')), pre1),
      h('section.dlg-sec', h('div.dlg-h', h('h4', 'Prompt 2 · One service only'), pick, h('span.grow'), copyBtn(() => pre2.textContent, () => pre2, 'Copy prompt 2')), pre2)),
    h('div.dlg-f', h('span.muted.xs', 'Writes only the AI description. The Human note is never touched.'), h('span.grow'), done));
  const scrim = h('div.scrim', { on: { mousedown: (e) => { if (e.target === scrim) close(); } } }, dlg);

  function onKey(e) {
    if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); return; }
    if (e.key !== 'Tab') return;
    const f = [...dlg.querySelectorAll('button, select, [tabindex="0"]')].filter((n) => !n.disabled);
    const first = f[0], last = f[f.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }
  document.addEventListener('keydown', onKey, true);
  document.body.append(scrim);
  x.focus();
  return { close };
}
