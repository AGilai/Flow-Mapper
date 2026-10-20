// Tab animations (Web Animations API). Opening a tab, 280 ms in two halves: the flow on screen shrinks to the left
// into its tab while the new tab grows from width 0 (140 ms, ease-in-out), then the new flow fades in and slides 12px
// from the right (140 ms, ease-out). Switching tabs is a 120 ms cross-fade. Reduced motion: one 80 ms cross-fade.

const reduced = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const run = (el, frames, o) => { try { return el.animate(frames, { fill: 'both', ...o }).finished.catch(() => {}); } catch { return Promise.resolve(); } };

/**
 * swap(from, to, { opening, tabEl }) -> Promise. `from` and `to` are panels (null allowed); the caller has already
 * made `to` the one that counts: this only controls what is visible while moving. Always ends with `from` hidden and
 * `to` shown, no leftover inline styles.
 */
export async function swap(from, to, { opening = false, tabEl = null } = {}) {
  const done = () => { if (from && from !== to) from.hidden = true; if (to) to.hidden = false; for (const e of [from, to, tabEl]) { e?.getAnimations?.().forEach((a) => a.cancel()); } };
  if (!to || from === to) { done(); return; }
  if (reduced()) {
    to.hidden = false; if (from) from.hidden = true;
    await run(to, [{ opacity: 0 }, { opacity: 1 }], { duration: 80 });
    done(); return;
  }
  if (!opening || !from) {
    if (from) from.hidden = true;
    to.hidden = false;
    await run(to, [{ opacity: 0 }, { opacity: 1 }], { duration: 120, easing: 'ease-out' });
    done(); return;
  }
  const ease = 'cubic-bezier(.4,0,.2,1)';
  const grow = tabEl ? run(tabEl, [{ maxWidth: '0px', minWidth: '0px', opacity: 0.2 }, { maxWidth: '230px', minWidth: '130px', opacity: 1 }], { duration: 140, easing: ease }) : Promise.resolve();
  from.style.transformOrigin = '0 0';
  to.hidden = true;
  await Promise.all([grow, run(from, [{ transform: 'scale(1) translateX(0)', opacity: 1 }, { transform: 'scale(.6) translateX(-10%)', opacity: 0.5, offset: 0.5 }, { transform: 'scale(0) translateX(-30%)', opacity: 0 }], { duration: 140, easing: ease })]);
  from.hidden = true; from.style.transformOrigin = '';
  to.hidden = false;
  await run(to, [{ opacity: 0, transform: 'translateX(12px)' }, { opacity: 1, transform: 'none' }], { duration: 140, easing: 'cubic-bezier(.2,.7,.2,1)' });
  done();
}
