// The "Step details" control of the flow toolbar (0.30.0, frame 17d): one button that says what is on, and a panel with two sections, Step bar and Arrows,
// each with Title / API / Description checkboxes, and presets. The arrows keep at least one field. Remembered per viewer (storage may be unavailable) and in the URL.

import { h } from '../dom.js';
import { BAR_DEFAULT, canon, toggle, summary, PRESETS } from './step-details-pure.js';

const KEY = { bar: 'flow-mapper.step-bar', arrows: 'flow-mapper.step-arrows' }, HL_KEY = 'flow-mapper.step-hl', CB_KEY = 'flow-mapper.comment-brackets';
export const storedHl = () => { try { return localStorage.getItem(HL_KEY) !== '0'; } catch { return true; } };
/** The viewer's own choice for the comment brackets layer (0.34.0), or null: then the default of the environment (on in a design, off in a harvested one). */
export const storedCb = () => { try { const v = localStorage.getItem(CB_KEY); return v === null ? null : v === '1'; } catch { return null; } };
const keepCb = (on) => { try { localStorage.setItem(CB_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ } };
const keepHl = (on) => { try { localStorage.setItem(HL_KEY, on ? '1' : '0'); } catch { /* storage unavailable */ } };
export const stored = (which, dflt) => { try { const v = localStorage.getItem(KEY[which]); return v == null ? dflt : v === '-' ? '' : canon(v) || dflt; } catch { return dflt; } };
const keep = (which, set) => { try { localStorage.setItem(KEY[which], set === '' ? '-' : set); } catch { /* storage unavailable */ } };

/** createStepMenu({ bar, arrows, hl = true, cb = false, onChange({ bar, arrows, hl, cb }) }) -> { el, set(bar, arrows), close() } */
export function createStepMenu({ bar, arrows, hl = true, cb = false, dflt = 'a', onChange }) {
  const FIELDS = [['t', 'Title'], ['a', 'API'], ['d', 'Description']];
  const label = h('span.sdm-l'), btn = h('button.btn.sm.sdm-btn', { type: 'button', 'aria-haspopup': 'true', 'aria-expanded': 'false', 'data-qa': 'step-details', on: { click: () => (panel.hidden ? open() : close()) } }, label, h('span.sdm-c', '▾'));
  const panel = h('div.sd-menu', { hidden: true, role: 'group', 'aria-label': 'Step details' });
  const el = h('span.sdm', btn, panel);

  const section = (which, title, note, min) => {
    const cur = which === 'bar' ? bar : arrows;
    return h('div.sdm-sec', h('h5', title, h('small', note)), ...FIELDS.map(([c, name]) => {
      const on = cur.includes(c), last = min && on && cur.length <= min;
      return h('label.sdm-o', { class: last ? 'locked' : '', title: last ? 'The arrows keep at least one field' : null }, h('input', { type: 'checkbox', checked: on, disabled: last, 'data-sd': `${which}-${c}`, on: { change: () => apply(which, toggle(cur, c, min)) } }), name);
    }));
  };
  function paint() {
    label.textContent = summary(bar, arrows);
    panel.replaceChildren(section('bar', 'Step bar', 'above the diagram', 0), section('arrows', 'Arrows', 'on the diagram', 1),
      h('div.sdm-sec.sdm-hl', h('label.sdm-o', { title: 'A soft yellow band behind the current step. The numbered dot always shows.' }, h('input', { type: 'checkbox', checked: hl, 'data-sd': 'highlight', on: { change: (e) => { hl = e.target.checked; keepHl(hl); onChange({ bar, arrows, hl, cb }); } } }), 'Highlight current step'),
        h('label.sdm-o', { title: 'Draw a bracket in the left gutter for each comment on a range of steps, and drag along the gutter to comment on one. On in design environments, off in harvested ones.' }, h('input', { type: 'checkbox', checked: cb, 'data-sd': 'brackets', on: { change: (e) => { cb = e.target.checked; keepCb(cb); onChange({ bar, arrows, hl, cb }); } } }), 'Comment brackets')),
      h('div.sdm-pre', ...PRESETS.map((p) => h('button.link', { type: 'button', on: { click: () => { bar = p.bar; arrows = p.arrows; keep('bar', bar); keep('arrows', arrows); paint(); onChange({ bar, arrows, hl, cb }); } } }, p.label))),
      h('p.sdm-n', 'The bar always has the stepper. A step shows the fields it has; a step with none of the chosen arrow fields shows its API.'));
  }
  function apply(which, set) {
    if (which === 'bar') bar = set; else arrows = set || dflt;
    keep(which, which === 'bar' ? bar : arrows); paint(); onChange({ bar, arrows, hl, cb });
  }
  const onDoc = (e) => { if (!el.contains(e.target)) close(); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); btn.focus(); } };
  function open() { paint(); panel.hidden = false; panel.style.left = '0'; panel.style.right = 'auto'; if (panel.getBoundingClientRect().right > innerWidth - 8) { panel.style.left = 'auto'; panel.style.right = '0'; } // keep it inside the window
     btn.setAttribute('aria-expanded', 'true'); document.addEventListener('mousedown', onDoc, true); panel.addEventListener('keydown', onKey); }
  function close() { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('mousedown', onDoc, true); panel.removeEventListener('keydown', onKey); }
  label.textContent = summary(bar, arrows);
  return { el, close, set(b, a, h2) { if (h2 != null) hl = h2; bar = b ?? BAR_DEFAULT; arrows = a ?? dflt; label.textContent = summary(bar, arrows); if (!panel.hidden) paint(); } };
}
