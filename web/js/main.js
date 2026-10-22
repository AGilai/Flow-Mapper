// Boot: load version and environments, render the rail, route to views.

import { h, clear, fill } from './dom.js';
import { api } from './api.js';
import { route, start, parseHash } from './router.js';
import { state, onEnvChange, setEnv, designFromQuery, designQuery, isDesign, pageEnv } from './state.js';
import { setQuery } from './router.js';
import { mountDesignStrip } from './design/design-strip.js';
import { renderRail } from './components/sidebar.js';
import { mountBugButton } from './components/bug-dialog.js';
import { requestedEnv, unknownEnv } from './env-missing.js';
import { startUnread, unreadCount, onUnread } from './users/unread.js';
import { questionCount, onQuestions, refreshQuestions } from './questions-store.js';

const rail = document.getElementById('rail');
const main = document.getElementById('main');

route('/envs/new', () => import('./views/env-new.js'));
route('/envs/:name/settings', () => import('./views/env-settings.js'));
route('/system', () => import('./views/system.js'));
route('/inventory', () => import('./views/inventory.js'));
route('/services', () => import('./views/inventory.js'));
route('/stores/:key', () => import('./views/store.js'));
route('/instances/:key', () => import('./views/instance.js'));
route('/channels/:key', () => import('./views/channel.js'));
route('/events/:type', () => import('./views/event.js'));
route('/services/:name', () => import('./views/service.js'));
route('/flows', () => import('./views/flows.js'));
route('/mentions', () => import('./views/mentions.js'));
route('/questions', () => import('./views/questions.js'));
route('/users', () => import('./views/users.js'));
route('/health', () => import('./views/health.js'));
route('/bugs', () => import('./views/bugs-list.js'));
route('/bugs/new', () => import('./views/bug-report.js'));
route('/bugs/:id', () => import('./views/bug-detail.js'));

async function boot() {
  try {
    const [v, envs, meta] = await Promise.all([api.version(), api.envs(), api.envMeta().catch(() => [])]);
    state.version = v.version;
    state.envMeta = meta;
    state.envs = envs.length ? envs : ['default'];
    if (!state.envs.includes(state.env)) state.env = state.envs.includes('prod') ? 'prod' : state.envs[0];
  } catch (err) {
    fill(main, h('div.content', h('div.error-box', `Could not reach the Flow-Mapper API: ${err.message}`)));
    return;
  }
  mountBugButton();
  let openBugs = 0;
  const refreshRail = () => renderRail(rail, parseHash().path, { '/bugs': openBugs || null, '/mentions': unreadCount() || null, '/questions': questionCount() || null });
  onUnread(refreshRail);
  onQuestions(refreshRail);
  startUnread();
  api.bugs({ open: true, limit: 1000 }).then((b) => { openBugs = b.length; refreshRail(); }).catch(() => {});

  /** The URL names an environment this page does not know (made after it loaded): look the list up once more. true when it is known now. */
  const learnEnv = async (name) => {
    try {
      const [envs, meta] = await Promise.all([api.envs(), api.envMeta().catch(() => state.envMeta)]);
      state.envMeta = meta; state.envs = envs.length ? envs : ['default'];
    } catch { /* keep the list we have */ }
    return !unknownEnv(name, state.envs);
  };
  const noEnv = (name) => {
    refreshRail();
    fill(main, h('div.content', h('div.env-missing', { 'data-qa': 'env-missing' }, h('b', `No environment ${name}`), h('p', 'It does not exist (or was deleted). Check the link, or choose one of the environments.'),
      h('button.btn.primary', { type: 'button', 'data-qa': 'env-missing-pick', on: { click: () => document.querySelector('.env-trigger')?.click() } }, 'Choose an environment'))));
  };

  start(async (r, params, loc) => {
    const want = unknownEnv(requestedEnv(loc.query, r.parts, params), state.envs);
    if (want && !(await learnEnv(want))) return noEnv(want);
    const named = r.parts[0] === 'envs' && params.name && state.envs.includes(params.name) && !loc.query.has('env'); // #/envs/<name>/settings names its environment in the path
    const d = designFromQuery(named ? new URLSearchParams([...loc.query, ['env', params.name]]) : loc.query);
    if (d.env !== state.env) setEnv(d.env, true);
    Object.assign(state, { mode: d.mode, draft: d.draft, compare: d.compare });
    setQuery({ ...designQuery(), ...(loc.query.get('env') === state.env ? { env: state.env } : {}), ...(pageEnv(r.parts, state.env) ? { env: state.env } : {}) }); // an env-specific page always carries `env=` (a link opens on the sender's env); a link that names its env keeps it on any page
    document.documentElement.classList.toggle('is-design', isDesign());
    refreshQuestions(); // the rail's "Questions (n)" of a design environment
    refreshRail();
    fill(main, h('div.loading', 'Loading…'));
    try {
      const mod = await r.load();
      clear(main);
      const view = await mod.render({ main, params, query: loc.query });
      const strip = mountDesignStrip(main);
      return { ...view, dispose: () => { view?.dispose?.(); strip?.dispose?.(); } };
    } catch (err) {
      console.error(err);
      fill(main, h('div.content', h('div.error-box', err.message || String(err))));
    }
  });
  onEnvChange(() => dispatchEvent(new HashChangeEvent('hashchange')));
}

boot();
