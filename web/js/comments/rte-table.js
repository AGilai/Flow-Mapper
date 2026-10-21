// Tables in the comment editor (0.27.0), our own code: insert a 3x3 (header row, two body rows), + row, - row, + col, - col, Tab between cells.
// A table is at most 50 rows x 20 columns (the sanitizer's limit too). Spans are not edited here: the editor makes tables without them.

export const MAX_ROWS = 50, MAX_COLS = 20;

export const cellOf = (area, node) => { const e = node?.nodeType === 1 ? node : node?.parentElement; const c = e?.closest?.('td, th'); return c && area.contains(c) ? c : null; };
const cell = (tag) => { const c = document.createElement(tag); c.append(document.createElement('br')); return c; };
const row = (tag, n) => { const r = document.createElement('tr'); for (let i = 0; i < n; i++) r.append(cell(tag)); return r; };
const caretIn = (c) => { const r = document.createRange(); r.selectNodeContents(c); r.collapse(true); const s = getSelection(); s.removeAllRanges(); s.addRange(r); };
const emptyPara = (n) => n.nodeName === 'P' && !n.textContent.trim() && n.querySelectorAll(':scope > br').length <= 1 && n.children.length <= 1;

/** Insert a table after the block the caret is in (an empty paragraph is replaced), with a paragraph after it to write in. */
export function insertTable(area, range, rows = 3, cols = 3) {
  const t = document.createElement('table'), head = document.createElement('thead'), body = document.createElement('tbody');
  head.append(row('th', cols));
  for (let i = 1; i < rows; i++) body.append(row('td', cols));
  t.append(head, body);
  let block = range?.startContainer ?? null;
  while (block && block.parentNode !== area) block = block.parentNode;
  if (!block) { area.append(t); } else if (emptyPara(block)) { block.replaceWith(t); } else block.after(t);
  if (!t.nextElementSibling) { const p = document.createElement('p'); p.append(document.createElement('br')); t.after(p); }
  caretIn(t.querySelector('th'));
}

const rowsOf = (t) => [...t.rows];
const colOf = (c) => c.cellIndex;

/** What the Table group can do with the caret in `c`: { addRow, delRow, addCol, delCol } (each a function) and the limits. */
export function tableOps(c) {
  const tr = c.parentElement, t = c.closest('table'), all = rowsOf(t), col = colOf(c), cols = tr.cells.length;
  const go = (target) => { if (target) caretIn(target); };
  return {
    canAddRow: all.length < MAX_ROWS, canDelRow: all.length > 1, canAddCol: cols < MAX_COLS, canDelCol: cols > 1,
    addRow() { const head = tr.parentElement.nodeName === 'THEAD', n = document.createElement('tr'); for (let i = 0; i < cols; i++) n.append(cell('td')); if (head) (t.tBodies[0] ?? t.appendChild(document.createElement('tbody'))).prepend(n); else tr.after(n); go(n.cells[Math.min(col, n.cells.length - 1)]); },
    delRow() { const next = tr.nextElementSibling ?? tr.previousElementSibling ?? all.find((r) => r !== tr); const sec = tr.parentElement; tr.remove(); if (!sec.rows.length) sec.remove(); go(next?.cells[Math.min(col, next.cells.length - 1)]); },
    addCol() { let mine = null; all.forEach((r) => { const ref = r.cells[col], n = cell(ref?.nodeName === 'TH' ? 'th' : 'td'); ref ? ref.after(n) : r.append(n); if (r === tr) mine = n; }); go(mine); },
    delCol() { all.forEach((r) => r.cells[col]?.remove()); go(tr.cells[Math.min(col, tr.cells.length - 1)]); },
  };
}

/** Tab moves to the next cell (a new row after the last one), Shift+Tab to the previous; before the first cell Shift+Tab leaves the table. */
export function onTab(area, e, range) {
  const c = cellOf(area, range?.startContainer);
  if (!c) return;
  const cells = [...c.closest('table').querySelectorAll('td, th')], i = cells.indexOf(c);
  if (e.shiftKey) { if (i > 0) { e.preventDefault(); caretIn(cells[i - 1]); } return; }
  e.preventDefault();
  if (i < cells.length - 1) caretIn(cells[i + 1]); else if (c.closest('table').rows.length < MAX_ROWS) tableOps(c).addRow();
}
