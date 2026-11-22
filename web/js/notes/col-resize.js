// Resizable table columns in the document editor (Unreleased). Near the right border of a first-row cell the pointer becomes col-resize; a drag moves
// that border (the next column gives or takes the width, so the sum stays), live, and on release writes `data-w` (percent) on the first-row cells.
// Double-click on the border drops `data-w` of that column (back to auto). There is no grip element: the cursor is the affordance, so nothing extra
// can end up in the saved HTML. Tables whose first row has a colspan are left alone (the columns would not line up).

import { resizePair, toPercent } from '../../core/col-width.js';
import { firstRow, applyColWidths } from './col-width.js';

const EDGE = 5; // px each side of a border

/** The first-row cell whose right border is under the pointer (not the last cell), or null. */
function hotCell(ed, e) {
  const at = document.elementFromPoint(e.clientX, e.clientY), cell = at?.closest?.('td, th'); // not e.target: during a capture it is the editor itself
  if (!cell || !ed.el.contains(cell)) return null;
  const table = cell.closest('table'), cells = firstRow(table);
  if (cell.parentElement !== table.rows[0] || cells.some((c) => c.colSpan > 1)) return null;
  const i = cells.indexOf(cell);
  if (i < 0 || i >= cells.length - 1 || Math.abs(e.clientX - cell.getBoundingClientRect().right) > EDGE) return null;
  return { table, cells, i };
}

/** attachColResize(ed): applies `data-w` after every setHtml and wires the drag. Returns { apply(), dispose() }. */
export function attachColResize(ed) {
  const area = ed.el, setHtml = ed.setHtml;
  const apply = () => applyColWidths(area);
  ed.setHtml = (v) => { setHtml(v); apply(); };
  let drag = null;

  const write = (cells, i, a, b) => { cells[i].setAttribute('data-w', String(a)); cells[i + 1].setAttribute('data-w', String(b)); apply(); };
  const move = (e) => {
    if (!drag) return;
    const [a, b] = resizePair(drag.a, drag.b, ((e.clientX - drag.x) / drag.tw) * 100);
    write(drag.cells, drag.i, a, b);
  };
  const up = (e) => {
    if (!drag) return;
    try { area.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    area.removeEventListener('pointermove', move); area.removeEventListener('pointerup', up); area.removeEventListener('pointercancel', up);
    area.classList.remove('col-dragging'); drag = null;
    ed.exec(() => {}); // fires the editor's change (dirty, draft)
  };
  const hover = (e) => { if (!drag) area.classList.toggle('col-hot', !!hotCell(ed, e)); };
  const down = (e) => {
    if (e.button !== 0 || drag) return;
    const hot = hotCell(ed, e);
    if (!hot) return;
    e.preventDefault();
    const { table, cells, i } = hot, tw = table.getBoundingClientRect().width;
    // pin the two columns to what they measure now; the rest stay auto (or keep their own data-w)
    const a = toPercent(cells[i].getBoundingClientRect().width, tw), b = toPercent(cells[i + 1].getBoundingClientRect().width, tw);
    drag = { cells, i, a, b, x: e.clientX, tw };
    area.setPointerCapture(e.pointerId);
    area.classList.add('col-dragging');
    area.addEventListener('pointermove', move); area.addEventListener('pointerup', up); area.addEventListener('pointercancel', up);
  };
  const dbl = (e) => {
    const hot = hotCell(ed, e);
    if (!hot) return;
    e.preventDefault();
    hot.cells[hot.i].removeAttribute('data-w');
    apply(); ed.exec(() => {});
  };
  area.addEventListener('pointermove', hover);
  area.addEventListener('pointerdown', down);
  area.addEventListener('dblclick', dbl);
  return { apply, dispose() { area.removeEventListener('pointermove', hover); area.removeEventListener('pointerdown', down); area.removeEventListener('dblclick', dbl); } };
}

