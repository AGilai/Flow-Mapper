// Domain colour families in the browser (frame 31): the registry per environment (filled when the subsystems load), the viewer's "Colour by" choice
// and the manual per-component colour override. The maths is core/domain-colours.ts; here are the CSS custom properties it produces (one <style>,
// light and dark by media query, so a theme switch needs no redraw) and what the flow and the map ask: a var() per component / domain / subsystem.
// Both settings are per viewer (localStorage; a failure is ignored). Without groups in the environment nothing here applies: colours are today's.

// No import of core/ here: component-colors.js (and the node tests that load it) reach this file; family-install.js has the maths and registers it.

const reg = new Map(); // env -> { groups, comp, dom, sub (name / key -> var()), css, prefix }
let seq = 0;
const listeners = new Set();
export const onColours = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const fire = () => listeners.forEach((f) => f());

function sheet() {
  if (typeof document === 'undefined') return;
  let el = document.getElementById('family-colours');
  if (!el) { el = document.createElement('style'); el.id = 'family-colours'; document.head.append(el); }
  el.textContent = [...reg.values()].map((r) => r.css).join('\n');
}

/** Register an environment (family-install.js): `entry` = { groups, css, comp, dom, sub (name / key -> var()), paint(theme) -> Map name -> shade }, or null when it has no groups. */
export function registerFamilies(env, entry) {
  const old = reg.get(env);
  if (!entry) { if (reg.delete(env)) { sheet(); fire(); } return; }
  if (old && old.css === entry.css) return;
  reg.set(env, { ...entry, hex: {} });
  sheet(); fire();
}
export const nextPrefix = (env) => reg.get(env)?.prefix ?? `e${seq++}`;

const KEY = 'flow-mapper.colorby', OVR = 'flow-mapper.cmp-override';
/** The viewer's explicit choice ('domain' | 'component'), or null (default). */
export const colourByStored = () => { try { const v = localStorage.getItem(KEY); return v === 'domain' || v === 'component' ? v : null; } catch { return null; } };
export const colourBySave = (v) => { try { localStorage.setItem(KEY, v); } catch { /* storage unavailable */ } fire(); };
export const hasFamilies = (env) => reg.has(env);
/** 'domain' when the environment has groups and the viewer did not pick Component, else 'component' (today's colours). */
export const modeOf = (env) => (reg.has(env) && colourByStored() !== 'component' ? 'domain' : 'component');
export const defaultMode = (env) => (reg.has(env) ? 'domain' : 'component');

const ovrAll = () => { try { return JSON.parse(localStorage.getItem(OVR) || '{}'); } catch { return {}; } };
/** The manual colour slot (1..8) of a component, or null: replaces only that component's shade, in both modes. */
export const overrideOf = (env, service) => { const n = ovrAll()?.[env]?.[service]; return n >= 1 && n <= 8 ? n : null; };
export function setOverride(env, service, slot) {
  const all = ovrAll(), m = { ...(all[env] ?? {}) };
  if (slot) m[service] = slot; else delete m[service];
  try { localStorage.setItem(OVR, JSON.stringify({ ...all, [env]: m })); } catch { /* storage unavailable */ }
  fire();
}

/** The var() of a component's shade in Domain mode: a group's shade, else flat grey (no group). null in Component mode or in an environment without groups. */
export function shadeVar(env, service) {
  if (modeOf(env) !== 'domain') return null;
  return reg.get(env).comp.get(service) ?? 'var(--fam-grey)';
}
/** The family colours of a component for the lifeline and the bands (domain / subsystem), or null (Component mode, no group). */
export function familyOf(env, service) {
  const r = modeOf(env) === 'domain' ? reg.get(env) : null;
  const sh = r?.comp.get(service);
  return sh ? { shade: sh, ...ownerOf(r, service) } : null;
}
const ownerOf = (r, service) => { for (const d of r.groups) for (const s of d.subs) if (s.comps.includes(service)) return { dom: r.dom.get(d.key) ?? null, sub: s.key ? r.sub.get(s.key) ?? null : null }; return {}; };
/** The var() of a band: a domain key (`platform`) or a second-level key (`platform/gcp`); null in Component mode. */
export const bandVar = (env, key) => { if (modeOf(env) !== 'domain') return null; const r = reg.get(env); return key?.includes('/') ? r.sub.get(key) ?? null : r.dom.get(key) ?? null; };

/** The colours as hex for the canvas map, which cannot read custom properties: { shade, dom } of a component in a theme, null outside Domain mode. */
export function shadeHex(env, service, theme) {
  if (modeOf(env) !== 'domain') return null;
  const r = reg.get(env), p = (r.hex[theme] ??= r.paint(theme)), s = p.get(service);
  return s ? { shade: s.st, dom: s.dom } : { shade: r.grey[theme], dom: null };
}
export const domainHex = (env, key, theme) => { if (modeOf(env) !== 'domain') return null; const r = reg.get(env), p = (r.hex[theme] ??= r.paint(theme)); for (const s of p.values()) if (s.domKey === key) return s.dom; return null; };
