// The hover popover on an activation bar: what that service does in this flow (the Human note, else the AI text).
// 400 ms delay on hover; keyboard focus shows it too. It never takes the pointer, so it cannot cover what you point at. Without a description it shows the call and "No description yet".

import { h } from '../dom.js';
import { lineText } from '../../core/description.js';
import { stripMarkdown } from '../../core/markdown-strip.js';
import { fmtDate } from './flow-desc.js';

/** createTip(store, root) -> { show(bar, anchor), hide(), dispose() } */
export function createTip(store, root) {
  let el = null, timer = 0, current = null;
  const hide = () => { clearTimeout(timer); current = null; el?.remove(); el = null; };
  function place(anchor) {
    const r = anchor.getBoundingClientRect(), w = el.offsetWidth, ht = el.offsetHeight;
    el.style.left = `${Math.max(8, Math.min(r.right + 10, innerWidth - w - 8))}px`;
    el.style.top = `${Math.max(8, Math.min(r.top, innerHeight - ht - 8))}px`;
  }
  async function paint(bar, anchor) {
    const d = store.peek(root) ?? await store.refresh(root).then(() => store.peek(root));
    if (current !== bar.id) return;
    const p = d?.callees?.[bar.service], l = lineText(p);
    const at = l ? (l.who === 'human' ? p.human.editedAt : p.ai.generatedAt) : null;
    el = h('div.desctip', { role: 'tooltip' }, h('div.tip-t', `${bar.service} in this flow`), l ? h('p', stripMarkdown(l.text)) : h('p.muted', bar.msg.label),
      h('div.tip-f', l ? [l.who === 'human' ? h('span.who-b', 'Human') : h('span.ai', 'AI'), ` ${fmtDate(at)}`, l.outdated ? h('span.chip-warn', 'outdated') : null, ' · double-click for the full chain'] : 'Double-click for the full chain'));
    document.body.append(el);
    place(anchor);
  }
  return {
    show(bar, anchor) { hide(); current = bar.id; timer = setTimeout(() => paint(bar, anchor), 400); },
    hide, dispose: hide,
  };
}
