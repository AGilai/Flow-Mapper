// Environment settings, "Colour": a radiogroup of the ten env colours plus Automatic. An annotation like the level names: allowed on sealed and
// design environments, saves on change, no draft. A colour another environment already uses is allowed; its swatch says "also <env>".
// The preview shows the swatches disabled (setting needs the server).

import { h, toast } from '../dom.js';
import { api, isPreview } from '../api.js';
import { state } from '../state.js';
import { envSlotOf } from '../env-info.js';
import { ENV_COLORS } from '../../core/env-colors.js';

/** `onSaved()` runs after a save (the page draws again with the new colour). */
export function colorSection(env, onSaved) {
  const meta = state.envMeta.find((m) => m.name === env), cur = envSlotOf(state.envMeta, env), auto = meta?.colorAuto === true;
  const others = (slot) => state.envMeta.filter((m) => m.name !== env && envSlotOf(state.envMeta, m.name) === slot).map((m) => m.name);
  async function save(color) {
    try { await api.putEnvColor(env, color); toast(color === null ? 'Colour: automatic' : `Colour: ${ENV_COLORS[color - 1]}`); await onSaved(); } catch (err) { toast(err.message, 5000); }
  }
  const opt = (value, text, swatch, extra) => h('label', { class: value === null ? 'auto' : '', title: value === null ? 'Automatic: follows the order environments were created in' : text },
    h('input', { type: 'radio', name: 'env-color', value: value ?? 'auto', checked: value === null ? auto : !auto && cur === value, disabled: isPreview, 'aria-label': text, 'data-qa': `env-color-${value ?? 'auto'}`,
      on: { change: () => save(value) } }),
    swatch, text, extra ? h('small', extra) : null);
  const swatch = (slot) => { const el = h('span.sw'); if (slot) el.style.setProperty('--ec', `var(--env-${slot})`); return el; };
  return h('section', { 'data-qa': 'env-color' }, h('h2', 'Colour'),
    h('p.es-note', 'Shown on this environment\'s flow tabs, in the environment picker and on the Flows list. Saved at once, on every environment.'),
    isPreview ? h('p.es-note', { 'data-qa': 'es-color-preview' }, 'Choosing a colour is not available in the preview: it needs the server.') : null,
    h('div.es-colors', { role: 'radiogroup', 'aria-label': 'Environment colour' }, opt(null, 'Automatic', swatch(0), auto ? `now ${ENV_COLORS[cur - 1]}` : ''),
      ENV_COLORS.map((name, i) => opt(i + 1, name, swatch(i + 1), others(i + 1).length ? `also ${others(i + 1).slice(0, 2).join(', ')}${others(i + 1).length > 2 ? '…' : ''}` : ''))));
}
