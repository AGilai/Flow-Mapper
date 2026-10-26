// The Simple view's parts of the Info pane (0.44.0, #90, frame 24c / 24d): a counted arrow lists every place it happens (code links) and where External shows it;
// a repeat marker says what a repeat is for its kind, jumps to the first one and offers "Expand here" (External with the first expansion unfolded under it).

import { h } from '../dom.js';

const web = (u) => (/^https?:\/\//i.test(u ?? '') ? u : null);
const seen = / ↩ seen at step \d+/;

/** "Happens N times": each occurrence as `fn · file:line` (a link when the code has a URL), the drawn one marked. ctx: { seenIn(keys) -> Promise<number[]>, jump(n), openExternal() }. null when the step happens once. */
export function occurrencesCard(m, trace, ctx = {}) {
  const occ = m.occurrences ?? [];
  if (occ.length < 2) return null;
  const seenBox = h('span.small.muted', { 'data-qa': 'seen-in-external' });
  const rows = occ.map((o, i) => {
    const at = o.service && o.fn && o.seq ? trace.code?.[`step:${o.service}:${o.fn}#${o.seq}`] : null, loc = at?.file ? `${at.file}${at.line ? `:${at.line}` : ''}` : o.seq ? `step ${o.seq}` : null, url = web(at?.url);
    const text = [o.fn, loc].filter(Boolean).join(' · ');
    return h('li', url ? h('a.ep-link-inline', { href: url, target: '_blank', rel: 'noopener noreferrer', title: url }, text) : h('span', text), i === 0 ? h('span.s', 'drawn here') : null);
  });
  const sum = m.dbGroup ? `${occ.length} calls to the same store from the same service are merged.` : `${occ.length} identical steps of the same service are merged.`;
  ctx.seenIn?.(occ.map((o) => o.key).filter(Boolean)).then((steps) => {
    if (!steps?.length) return;
    seenBox.replaceChildren('Seen in External at steps ', ...steps.flatMap((n, k) => [k ? ', ' : null, h('button.lnk', { type: 'button', on: { click: () => { ctx.openExternal?.().then?.(() => ctx.jump?.(n)); } } }, String(n))]));
  }, () => {});
  return h('section.ep-card.simple-pane', { 'data-qa': 'occurrences' }, h('header', h('h3', `Happens ${occ.length} times`)), h('p.small', 'Simple draws this once, at the first place it happens. ', sum), h('ul.simple-occ', rows),
    h('div.ep-pad.stack', { style: { gap: '4px' } }, seenBox, ctx.openExternal ? h('button.lnk', { type: 'button', 'data-qa': 'open-external', on: { click: () => ctx.openExternal() } }, 'Open in External →') : null));
}

/** What a repeat of this message is, in its own words (the pane used to say "the same delivery" for every kind). */
export const repeatText = (m) => m.kind === 'call' ? 'The same function call (same bound values) already ran, so its steps are not drawn again.'
  : m.kind === 'deliver' ? 'The same delivery (consumer, ingress, event) is drawn once per trace, so nothing is shown below this arrow.'
    : 'The same call (same endpoint, same bound values) already ran, so its steps are not drawn again.';

/** The repeat marker's block: the text, a link to the first one and "Expand here" (or "Fold back" once it is unfolded). ctx: { jump(n), expandHere(key), foldBack(key), unfolded(key) }. */
export function repeatCard(m, trace, ctx = {}) {
  if (!m.repeatOf) return null;
  const first = trace.messages.filter((x) => !x.unfoldOf)[m.repeatOf - 1], on = ctx.unfolded?.(m.key);
  return h('div.simple-pane', { 'data-qa': 'repeat-card' }, h('p.small', h('b', `↩ Same as step ${m.repeatOf}. `), repeatText(m), first ? h('span.key', ` ${String(first.label).replace(seen, '')}`) : null),
    ctx.jump ? h('button.lnk', { type: 'button', 'data-qa': 'repeat-jump', on: { click: () => ctx.jump(m.repeatOf) } }, `Jump to step ${m.repeatOf} ↗`) : null,
    ctx.expandHere && m.key ? h('div.simple-exp', on ? h('button.simple-btn', { type: 'button', 'data-qa': 'fold-back', on: { click: () => ctx.foldBack(m.key) } }, 'Fold back') : h('button.simple-btn', { type: 'button', 'data-qa': 'expand-here', on: { click: () => ctx.expandHere(m.key) } }, 'Expand here'),
      h('p', on ? 'The first expansion is drawn under this arrow.' : 'Opens External with this call\'s steps unfolded in place, right under this arrow.')) : null);
}
