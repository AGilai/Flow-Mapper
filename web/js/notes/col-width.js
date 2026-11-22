// Column widths of a document table (Unreleased): `data-w` (percent) on the FIRST row's cells is applied as an inline width and the table goes
// `table-layout: fixed`, so cells without it share the rest. Used by the reader and the editor; the stored form is only `data-w`.

import { parseWidth } from '../../core/col-width.js';

/** The first-row cells of `table`. */
export const firstRow = (table) => [...(table.rows[0]?.cells ?? [])];

/** Apply `data-w` of the first row of every table under `root` (or of one table). */
export function applyColWidths(root) {
  const tables = root.matches?.('table') ? [root] : [...root.querySelectorAll('table')];
  for (const t of tables) {
    let any = false;
    for (const c of firstRow(t)) { const w = parseWidth(c.getAttribute('data-w')); c.style.width = w ? `${w}%` : ''; if (w) any = true; }
    t.style.tableLayout = any ? 'fixed' : '';
  }
}
