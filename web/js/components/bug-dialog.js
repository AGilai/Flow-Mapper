// "Report a bug" on every screen: a floating round button (bottom-right; label on hover/focus) that opens the bug form in a modal
// dialog over the current page, so the route, scroll, panels and selections stay as they were. Mounted once from main.js.

import { h, toast } from '../dom.js';
import { icon } from '../icons.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { parseHash } from '../router.js';
import { bugForm } from './bug-form.js';

const drafts = {}; // unsent text per environment survives closing the dialog; cleared after a successful submit
let busy = false;

/** The service the current route is about: /services/:name, or ?service= (flows page, bug links). */
function routeService() {
  const { path, query } = parseHash();
  const m = path.match(/^\/services\/([^/]+)/);
  return m ? decodeURIComponent(m[1]) : query.get('service');
}

/** The page as the reporter sees it: "Flows - #/flows?service=x&step=3". */
const seenLabel = () => location.hash || '#/';

export async function openBugDialog(opener = document.activeElement) {
  if (busy) return;
  busy = true;
  try {
    const services = (await api.services(state.env)).filter((s) => s.kind !== 'infra').map((s) => s.name);
    const url = location.href, service = routeService(), draft = (drafts[state.env] ??= {});
    const close = () => { dlg.close(); dlg.remove(); busy = false; (opener?.isConnected ? opener : document.getElementById('bug-fab'))?.focus?.(); };
    const { el, title } = bugForm({
      services, service: draft.service ?? service, seenOn: url, draft,
      onDone: (bug) => {
        close();
        toast(h('span', `Bug #${bug.id} reported `, h('a', { href: `#/bugs/${bug.id}`, style: { color: 'inherit', textDecoration: 'underline' } }, 'View')), 6000);
      },
      cancel: h('button.btn.ghost', { type: 'button', on: { click: close } }, 'Cancel'),
    });
    const dlg = h('dialog.bug-dialog', { 'aria-label': 'Report a bug',
      on: { cancel: (e) => { e.preventDefault(); close(); }, mousedown: (e) => { if (e.target === dlg) close(); } } },
      h('div.bug-dialog-in',
        h('div.bug-dialog-head', h('h2', 'Report a bug'), h('button.btn.ghost.icon-btn', { type: 'button', 'aria-label': 'Close', title: 'Close', on: { click: close } }, '×')),
        h('p.small.muted.bug-seen', { title: url }, 'Seen on: ', h('span.key', seenLabel()), h('span', ` · env ${state.env}${state.draft ? ` · draft ${state.draft}` : ''}`)),
        el));
    document.body.append(dlg);
    dlg.showModal();
    title.focus();
  } catch (err) {
    busy = false;
    toast(`Could not open the bug form: ${err.message}`);
  }
}

/** The floating button. Hidden on #/bugs/new (that page is the form); lifted left of an open right-hand panel. */
export function mountBugButton() {
  const btn = h('button.bug-fab#bug-fab', { type: 'button', 'aria-label': 'Report a bug', on: { click: () => openBugDialog(btn) } },
    icon('bug'), h('span.bug-fab-label', 'Report a bug'));
  document.body.append(btn);
  let queued = false;
  const place = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; layout(); });
  };
  const layout = () => {
    btn.hidden = parseHash().path === '/bugs/new';
    const p = [...document.querySelectorAll('.panel.open')].map((e) => e.getBoundingClientRect()).find((r) => r.width > 0 && r.width < innerWidth * 0.8 && r.right > innerWidth - 40);
    btn.style.right = p ? `${Math.round(innerWidth - p.left + 16)}px` : '';
  };
  addEventListener('hashchange', place);
  addEventListener('resize', place);
  document.addEventListener('fm:layout', place);
  new MutationObserver(place).observe(document.getElementById('main'), { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'style'] });
  layout();
}
