// "Group by" of the Flows list (0.32.5, #79), pure parts: the two modes, their default per environment kind, the URL form, the remembered choice per
// environment, and the flat order. `component` = one heading per component (the harvested default); `none` = one flat list in natural name order
// (a design's default). The URL carries `group=` only when it is not the kind's default.

export const MODES = ['component', 'none'];
export const groupDefault = (design) => (design ? 'none' : 'component');

/** `group=` of a query: a mode, or null when absent or unknown (use the remembered one, then the kind's default). */
export function decodeGroup(query) {
  const v = query.get('group');
  return MODES.includes(v) ? v : null;
}
export const encodeGroup = (mode, design) => (mode === groupDefault(design) ? null : mode);

const key = (env) => `flow-mapper.flows-group:${env}`;
export function storedGroup(env, design) {
  try { const v = localStorage.getItem(key(env)); return MODES.includes(v) ? v : groupDefault(design); } catch { return groupDefault(design); }
}
export function saveGroup(env, mode) { try { localStorage.setItem(key(env), mode); } catch { /* storage unavailable */ } }
/** The mode to start in: the URL, else the one remembered for this environment, else the kind's default. */
export const startGroup = (query, env, design) => decodeGroup(query) ?? storedGroup(env, design);

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
/** Natural order: numeric runs compare as numbers (`ARL_2` before `ARL_10`), case does not matter. */
export const naturalCompare = (a, b) => collator.compare(String(a ?? ''), String(b ?? ''));

const labelOf = (p) => String(p.bindKey ?? '').replace(/^[^:]*:/, ''); // the key as the row shows it, without the transport prefix
/** The flat order: named flows by name, then the unnamed ones by their label (the entry key); ties by component. A new array. */
export function flatOrder(points) {
  return [...points].sort((a, b) => (!a.name - !b.name) || naturalCompare(a.name || labelOf(a), b.name || labelOf(b)) || naturalCompare(a.service, b.service));
}
