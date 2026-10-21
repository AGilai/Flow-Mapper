// Report a bug (page): the shared form from components/bug-form.js. The floating button opens the same form in a dialog.

import { h, toast } from '../dom.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { go } from '../router.js';
import { pageHead } from '../components/page.js';
import { bugForm } from '../components/bug-form.js';

export async function render({ main, query }) {
  const services = (await api.services(state.env)).filter((s) => s.kind !== 'infra').map((s) => s.name);
  const { el, title } = bugForm({
    services, service: query.get('service'),
    onDone: (bug) => { toast(`Bug #${bug.id} reported`); go(`/bugs/${bug.id}`); },
    cancel: h('a.btn.ghost', { href: '#/bugs' }, 'Cancel'),
  });
  main.append(pageHead('Report a bug', 'Bugs in Flow-Mapper itself: the map, the views, the API or MCP.'), h('div.content', el));
  title.focus();
}
