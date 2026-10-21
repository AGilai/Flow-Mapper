// The Mermaid import dialog's logic with no DOM (0.27.2): what a participant's select offers, how a select value maps to the `matches` the
// server takes, what the amber bar says, and the preview's tiles and warnings. Pure, so a test can run it.

const plural = (n, one, many = one + 's') => `${n} ${n === 1 ? one : many}`;
export const joinNames = (names) => (names.length < 3 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

/** The select's options for one participant row: [{ value, label, note? }]. Values: `c:<component>`, `new`, `src`, `client`, `skip`. */
export function optionsFor(row, components, source) {
  const out = [];
  if (row.actor) out.push({ value: 'client', label: 'Entry client (not a component)' });
  if (row.how === 'infra') out.push({ value: 'skip', label: 'Skip (channel or data store)' });
  out.push({ value: 'new', label: '＋ create new' });
  if (row.source && source) out.push({ value: 'src', label: `Import from ${source} (one level)`, note: `Exists in ${source}. Importing copies its endpoints and handlers, one level.` });
  for (const c of components) out.push({ value: `c:${c}`, label: c });
  return out;
}

export function valueOf(choice) {
  if (!choice) return 'new';
  if ('component' in choice) return `c:${choice.component}`;
  if ('fromSource' in choice) return 'src';
  return 'create' in choice ? 'new' : 'client' in choice ? 'client' : 'skip';
}
export function choiceOf(value, row) {
  if (value.startsWith('c:')) return { component: value.slice(2) };
  if (value === 'src') return { fromSource: true };
  if (value === 'client') return { client: true };
  if (value === 'skip') return { skip: true };
  return { create: true, name: row.createName };
}

/** The names that will be created (not the ones copied from the source, and not those already in the design). */
export function createdNames(rows, choices, components) {
  const names = rows.flatMap((r) => { const c = choices[r.id]; return c && 'create' in c ? [c.name ?? r.createName] : []; });
  return [...new Set(names)].filter((n) => !components.includes(n));
}
export const copiedNames = (rows, choices) => [...new Set(rows.flatMap((r) => (choices[r.id] && 'fromSource' in choices[r.id] ? [r.source ?? r.createName] : [])))];

/** The amber bar above the table; null when nothing is created. */
export function barText(names, group) {
  if (!names.length) return null;
  return `${plural(names.length, 'component')} will be created: ${names.join(', ')}${group ? ` in ${group}` : ''}`;
}

/** The chip of a row: [text, class]. */
export function chipOf(row, choice) {
  if (row.how === 'in-prod') return [`in ${row.sourceName ?? 'prod'}`, 'prod'];
  const map = { exact: ['exact', 'exact'], alias: ['exact', 'exact'], normalized: ['normalized', 'norm'], similar: ['similar', 'similar'], actor: ['actor', 'actor'], infra: ['not a component', 'prod'], none: ['not found', ''] };
  const [text, cls] = map[row.how] ?? ['', ''];
  return choice && 'component' in choice && row.match && choice.component !== row.match ? ['changed', 'norm'] : [text, cls];
}

/** The hint under a row's select (or null). */
export function hintOf(row, choice, source) {
  if (choice && 'create' in choice) return row.how === 'in-prod' ? `Exists in ${source}. Open the select to import it from ${source} (one level) instead.` : row.how === 'infra' ? null : 'Not in this environment: becomes a new component with no endpoints yet.';
  if (choice && 'client' in choice) return 'Entry point: the first message comes from this client.';
  if (choice && 'skip' in choice) return 'Its messages are left out.';
  if (choice && 'fromSource' in choice) return `Copied from ${source}: its endpoints and handlers, one level.`;
  return row.note && choice && 'component' in choice && choice.component === row.match ? row.note : null;
}

/** The preview step's tiles: [[big, small]]. */
export function tiles(p) {
  const c = p.counts, flow = p.flow;
  return [[`+${c.components}`, c.components === 1 ? 'component' : 'components'], [`+${c.endpoints}`, c.endpoints === 1 ? 'endpoint' : 'endpoints'], [`+${c.calls}`, c.calls === 1 ? 'call' : 'calls'],
    [`${c.notes}`, c.notes === 1 ? 'step description' : 'step descriptions'], ...(p.imports?.length ? [[`${p.imports.reduce((n, x) => n + x.total, 0)}`, `items from ${p.imports[0].source}`]] : []), ...(flow?.name ? [['Flow name', `'${flow.name}'`]] : [])];
}

/** The preview step's warnings as plain strings (the server's, then what the table implies): [{ text, line? }]. */
export function previewWarnings(p, rows, choices, group) {
  const out = (p.warnings ?? []).map((w) => ({ text: w.text, ...(w.line ? { line: w.line } : {}) }));
  if (p.creates.length) out.push({ text: `${joinNames(p.creates)} ${p.creates.length === 1 ? 'is a new component' : 'are new components'}${group ? ` in ${group}` : ''}, with no endpoints known beyond the calls below.` });
  if (p.undecided.length) out.push({ text: `${plural(p.undecided.length, 'message')} ${joinNames(p.undecided)} ${p.undecided.length === 1 ? 'has' : 'have'} no METHOD /path: ${p.undecided.length === 1 ? 'its endpoint is' : 'their endpoints are'} created as undecided.` });
  for (const r of rows) if (r.how === 'similar' && choices[r.id]?.component === r.match) out.push({ text: `${r.label} was matched to ${r.match} by close spelling.` });
  return out;
}

/** The line under the flow after an import (frame 14e). */
export function afterText(out, group) {
  const c = out.counts, bits = [`${plural(c.calls, 'call')}`];
  if (c.components) bits.push(`${plural(c.components, 'new component')}${group ? ` in ${group}` : ''}`);
  if (c.notes) bits.push(`${plural(c.notes, 'step description')}`);
  return `Imported from Mermaid: ${bits.join(', ')}.${out.undecided?.length ? ' Undecided transport shows as a dashed arrow until you pick one in the call\'s form.' : ''}`;
}
