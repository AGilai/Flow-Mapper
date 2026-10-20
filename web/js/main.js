// Boot: load version and environments, render the rail, route to views.

import { h, clear, fill } from './dom.js';
import { api } from './api.js';
import { route, start, parseHash } from './router.js';
import { state, onEnvChange } from './state.js';
import { renderRail } from './components/sidebar.js';

const rail = document.getElementById('rail');
const main = document.getElementById('main');

route('/system', () => import('./views/system.js'));
route('/inventory', () => import('./views/inventory.js'));
route('/services', () => import('./views/inventory.js'));
route('/stores/:key', () => import('./views/store.js'));
route('/instances/:key', () => import('./views/instance.js'));
route('/channels/:key', () => import('./views/channel.js'));
route('/events/:type', () => import('./views/event.js'));
route('/services/:name', () => import('./views/service.js'));
route('/flows', () => import('./views/flows.js'));
route('/health', () => import('./views/health.js'));
route('/bugs', () => import('./views/bugs-list.js'));
route('/bugs/new', () => import('./views/bug-report.js'));
route('/bugs/:id', () => import('./views/bug-detail.js'));

async function boot() {
  try {
    const [v, envs] = await Promise.all([api.version(), api.envs()]);
    state.version = v.version;
    state.envs = envs.length ? envs : ['default'];
    if (!state.envs.includes(state.env)) state.env = state.envs.includes('prod') ? 'prod' : state.envs[0];
  } catch (err) {
    fill(main, h('div.content', h('div.error-box', `Could not reach the Flow-Mapper API: ${err.message}`)));
    return;
  }
  let openBugs = 0;
  const refreshRail = () => renderRail(rail, parseHash().path, { '/bugs': openBugs || null });
  api.bugs({ open: true, limit: 1000 }).then((b) => { openBugs = b.length; refreshRail(); }).catch(() => {});

  start(async (r, params, loc) => {
    refreshRail();
    fill(main, h('div.loading', 'Loading…'));
    try {
      const mod = await r.load();
      clear(main);
      return await mod.render({ main, params, query: loc.query });
    } catch (err) {
      console.error(err);
      fill(main, h('div.content', h('div.error-box', err.message || String(err))));
    }
  });
  onEnvChange(() => dispatchEvent(new HashChangeEvent('hashchange')));
}

boot();
