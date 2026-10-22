// Questions (0.33.0, info pane extra 1): the list items of every "## Open questions" section in the About of the environment's components and subsystems, in one list,
// as the open draft leaves them. A row opens the info pane of its item, scrolled to the question. Grouped by subsystem; a filter box narrows by item or text.

import { h } from '../dom.js';
import { api } from '../api.js';
import { state, isDesign } from '../state.js';
import { href } from '../router.js';
import { pageHead } from '../components/page.js';
import { icon } from '../icons.js';
import { loadSubsystems } from '../design/subsystems-store.js';
import { renderChips, refreshChips } from '../users/chips.js';
import { loadUsers } from '../users/directory.js';
import { questionLink, groupQuestions, filterQuestions, plainQuestion } from './questions-pure.js';

export async function render({ main }) {
  const [data, subs] = await Promise.all([api.openQuestions(state.env), loadSubsystems()]);
  const all = data.questions;
  const find = h('input.input', { type: 'search', placeholder: 'Filter by item or question', 'aria-label': 'Filter questions', 'data-qa': 'q-filter' });
  const body = h('div.content.q-body');
  main.append(pageHead('Questions', all.length ? `${all.length} open ${all.length === 1 ? 'question' : 'questions'} in ${state.env}` : `Nothing open in ${state.env}`, h('div.search', icon('search'), find)), body);

  const render1 = (q) => h('a.q-row', { href: href('/system', questionLink(q)), 'data-qa': 'q-row' },
    h('span.q-mark', { 'aria-hidden': 'true' }, '?'), renderChips(h('span.q-text', plainQuestion(q.text))), h('span.q-item', h('b', q.label), h('small', q.kind === 'subsystem' ? 'subsystem' : 'component')));
  function draw() {
    const groups = groupQuestions(filterQuestions(all, find.value), (k) => subs.labelOf(k) || 'Not set');
    if (!all.length) { body.replaceChildren(h('div.q-empty', { 'data-qa': 'q-empty' }, h('b', 'No open questions'), h('p', isDesign() ? 'Write a list under a "## Open questions" heading in the About of a component or a subsystem and it appears here.' : 'No About in this environment has an "Open questions" list.'))); return; }
    body.replaceChildren(...(groups.length ? groups.map((g) => h('section.q-group', h('h3', g.label, h('small', ` ${g.items.length}`)), h('div.q-list', g.items.map(render1)))) : [h('p.muted', 'No question matches.')]));
  }
  find.addEventListener('input', draw);
  draw();
  loadUsers().then(() => refreshChips(body)).catch(() => {}); // a mention in a question is a chip with the user's name
}
