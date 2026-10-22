// The About of the info pane (0.33.0): the text split into its `##` sections with their sanitized HTML (`loadAbout`, loads the core/ modules on first use so node
// tests of the pure parts need no core/*.ts), the blocks of the drawer (`aboutBlocks`, `aboutSection`) and the rows of the expanded page (`aboutRows`).

import { h } from '../dom.js';
import { block } from './pane-parts.js';
import { renderChips, refreshChips } from '../users/chips.js';
import { loadUsers } from '../users/directory.js';

const EMPTY = { md: '', has: false, sections: [], questions: 0 };

/** loadAbout(md) -> { md, has, sections: [{ title, html, q, count, id }], questions }. `q`: an "Open questions" section; `count`: its list items. */
export async function loadAbout(md) {
  if (typeof md !== 'string' || !md.trim()) return EMPTY;
  const [S, M] = await Promise.all([import('../../core/about-sections.js'), import('../../core/markdown-lite.js')]);
  let questions = 0;
  const sections = S.aboutSections(md).map((s, i) => {
    const q = S.isQuestions(s.title), count = q ? S.openQuestions(`## ${s.title}\n${s.body}`).length : 0;
    questions += count;
    return { title: s.title, html: M.aboutHtml(s.body), q, count, id: `s${i}`, offset: s.offset };
  });
  return { md, has: true, sections, questions };
}

const emptyHarvested = () => h('div.pane-empty', { 'data-qa': 'about-empty' }, h('b', 'No description yet'),
  h('p', 'This is a harvested environment, so it is read-only here. A description comes from the harvester (', h('code', 'service.about'), ') or from a design environment that copies this component.'));

/** The text of one section as a node (`s.html` is sanitized by core/markdown-lite); an `@[userId]` in it is a chip (0.33.0), named by the users registry. */
export function sectionBody(s) {
  const el = h('div.pane-md', { html: s.html });
  for (const p of el.querySelectorAll('p > strong')) if (p.parentElement.textContent.trim() === p.textContent.trim()) p.parentElement.classList.add('h'); // a paragraph that is only a bold run is a ### heading (the sanitizer has no heading tags)
  if (s.html.includes('@[')) { renderChips(el); loadUsers().then(() => refreshChips(el)).catch(() => {}); }
  return el;
}

/** The About blocks of the drawer: one per `##` section (the text before the first has no heading), "Open questions" tinted with its count.
 *  `pen` (design/pencil.js `about()`): { whole, empty, section(title) }; `design`: this environment can hold a description. */
export function aboutBlocks(model, { pen = null, design = false } = {}) {
  const box = h('div.pane-abs', { 'data-qa': 'about-body' });
  if (!model.has) {
    box.append(design ? h('div.pane-empty', { 'data-qa': 'about-empty' }, h('b', 'No description yet'), h('p', 'Say what this is for, who owns it and what is still open. It appears here, in reviews and in the exports.'), pen?.empty ?? null) : emptyHarvested());
    return box;
  }
  for (const s of model.sections) {
    box.append(h('div.pane-ab', { class: s.q ? 'q' : '', 'data-section': s.title, id: s.q ? 'pane-questions' : null },
      s.title ? h('h5', s.title, s.q && s.count ? h('small', String(s.count)) : null, s.title ? pen?.section?.(s.title) ?? null : null) : null, sectionBody(s)));
  }
  return box;
}

/** The "About" block with its whole-text pencil. */
export const aboutSection = (model, opts = {}) => block('about', 'About', { right: model.has ? opts.pen?.whole ?? null : null }, aboutBlocks(model, opts));

/** The rows of the expanded page: About holds every section but "Open questions" (that is a row of its own, tinted even when closed). [{ about, questions }] row defs. */
export function aboutRows(model, { pen = null, design = false } = {}) {
  if (!model.has) return { about: { id: 'about', title: 'About', small: design ? 'nothing written yet' : 'harvested, read-only', body: () => aboutBlocks(model, { pen, design }) }, questions: null };
  const plain = model.sections.filter((s) => !s.q), qs = model.sections.filter((s) => s.q);
  const about = { id: 'about', title: 'About', small: `${plain.filter((s) => s.title).length} sections`, right: pen?.whole ?? null,
    children: plain.map((s) => ({ id: `about-${s.id}`, title: s.title || 'Introduction', right: s.title ? pen?.section?.(s.title) ?? null : null, body: () => sectionBody(s) })) };
  const n = qs.reduce((t, s) => t + s.count, 0);
  const questions = qs.length ? { id: 'q', title: 'Open questions', count: n, q: true, right: pen?.section?.(qs[0].title) ?? null, body: () => h('div.pane-ab.q', qs.map(sectionBody)) } : null;
  return { about, questions };
}
