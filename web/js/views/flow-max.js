// Maximize a flow (0.29.1; docs/plans/maximize.md, frame 16): the active tab takes the whole window (body.is-max hides the chrome, flow-max.css),
// the page asks the browser for real full screen too, and a floating "Exit full screen" pill leaves it. State: body class + `max=1` in the URL.

import { h } from '../dom.js';
import { icon } from '../icons.js';
import { setQuery } from '../router.js';
import { maxKeyAction, maxPatch } from './flow-max-pure.js';

const DIM_MS = 2000;
const dialogOpen = () => !!document.querySelector('dialog[open], .scrim');

/** createMax({ onChange(on) }) -> { button(), isOn(), set(on, opts), dispose() } */
export function createMax({ onChange } = {}) {
  let on = false, fs = false, pill = null, dimT = 0, shut = [];
  const wake = () => { pill?.classList.remove('dim'); clearTimeout(dimT); dimT = setTimeout(() => pill?.classList.add('dim'), DIM_MS); };

  /** Mark the tabs and open every section (a tab built while maximized calls this too); leaving closes the ones it opened. */
  function sync() {
    document.querySelectorAll('.flow-tab').forEach((t) => (on ? t.setAttribute('data-max', '') : t.removeAttribute('data-max')));
    if (on) { const c = [...document.querySelectorAll('.flow-tab details.cm-sec:not([open])')]; c.forEach((d) => { d.open = true; }); shut.push(...c); }
    else { shut.forEach((d) => { if (d.isConnected) d.open = false; }); shut = []; }
  }

  function set(next, { fullscreen = true, url = true } = {}) {
    next = !!next;
    if (next === on) return;
    on = next;
    document.body.classList.toggle('is-max', on);
    sync();
    if (on) {
      pill = h('button.max-exit', { type: 'button', 'aria-label': 'Exit full screen', 'data-qa': 'max-exit', on: { click: () => set(false), focus: wake } },
        icon('unmax'), h('span.lbl', 'Exit full screen'), h('kbd', 'Esc'));
      document.body.append(pill); wake();
      if (fullscreen) try { document.documentElement.requestFullscreen?.()?.then(() => { fs = true; }).catch(() => {}); } catch { /* refused: the window is still filled */ }
    } else {
      pill?.remove(); pill = null; clearTimeout(dimT);
      if (fs || document.fullscreenElement) { fs = false; try { document.exitFullscreen?.()?.catch(() => {}); } catch { /* not in full screen */ } }
    }
    if (url) setQuery(maxPatch(on));
    onChange?.(on);
    requestAnimationFrame(() => document.dispatchEvent(new CustomEvent('fm:layout'))); // the diagram measures itself again
  }
  const onKey = (e) => {
    const a = maxKeyAction(e, { maximized: on, dialogOpen: dialogOpen() });
    if (!a || (a === 'toggle' && !document.querySelector('.flow-tab'))) return;
    if (a === 'toggle' && !document.querySelector('.flows')) return;
    e.preventDefault(); set(a === 'toggle' ? !on : false);
  };
  const onFs = () => { if (on && fs && !document.fullscreenElement) { fs = false; set(false); } }; // the browser left full screen (its own Esc)
  addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', onFs);
  document.addEventListener('pointermove', wake, { passive: true });

  /** The icon button for a flow header. */
  const button = () => h('button.btn.sm.icon-only.max-btn', { type: 'button', 'data-qa': 'maximize', title: 'Maximize (F)', 'aria-label': 'Maximize (F)',
    on: { click: (e) => { e.preventDefault(); e.stopPropagation(); set(true); } } }, icon('maximize'));

  return { button, isOn: () => on, set, sync,
    dispose: () => { removeEventListener('keydown', onKey); document.removeEventListener('fullscreenchange', onFs); document.removeEventListener('pointermove', wake); set(false, { url: false }); } };
}
