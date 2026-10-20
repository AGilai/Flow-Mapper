// Sortable, filterable, paged table. Renders only one page of rows, so it stays fast with thousands.
//
// dataTable({ columns: [{key, label, render?, sort?, num?}], rows, pageSize, onRow, filter?: (row, q) => bool })

import { h, clear, fill } from '../dom.js';

export function dataTable({ columns, rows, pageSize = 50, onRow, sortKey, sortDir = 'asc', empty = 'Nothing to show.' }) {
  let page = 0;
  let sort = sortKey ?? null;
  let dir = sortDir;
  let data = rows;
  const tbody = h('tbody');
  const pager = h('div.pager');
  const head = h('tr');
  const table = h('table.grid', h('thead', head), tbody);
  const el = h('div', h('div', { style: { overflowX: 'auto' } }, table), pager);

  const value = (row, c) => (c.sort ? c.sort(row) : row[c.key]);
  function sorted() {
    if (!sort) return data;
    const c = columns.find((x) => x.key === sort);
    const m = dir === 'asc' ? 1 : -1;
    return [...data].sort((a, b) => {
      const va = value(a, c), vb = value(b, c);
      return (va == null) - (vb == null) || (va < vb ? -m : va > vb ? m : 0);
    });
  }

  function renderHead() {
    fill(head, ...columns.map((c) =>
      h('th', { 'aria-sort': sort === c.key ? (dir === 'asc' ? 'ascending' : 'descending') : null, style: c.num ? { textAlign: 'right' } : null },
        c.nosort ? c.label : h('button', { on: { click: () => { dir = sort === c.key && dir === 'asc' ? 'desc' : 'asc'; sort = c.key; page = 0; render(); } } }, c.label))));
  }

  function render() {
    renderHead();
    const all = sorted();
    const pages = Math.max(1, Math.ceil(all.length / pageSize));
    page = Math.min(page, pages - 1);
    const slice = all.slice(page * pageSize, page * pageSize + pageSize);
    fill(tbody, ...(slice.length ? slice.map((r) =>
      h('tr', { class: onRow ? 'clickable' : '', tabindex: onRow ? 0 : null,
        on: onRow ? { click: () => onRow(r), keydown: (e) => { if (e.key === 'Enter') onRow(r); } } : {} },
        columns.map((c) => h('td', { class: c.num ? 'num' : '' }, c.render ? c.render(r) : String(r[c.key] ?? ''))))) :
      [h('tr', h('td.muted', { colSpan: columns.length }, empty))]));
    fill(pager, 
      h('span', `${all.length.toLocaleString()} ${all.length === 1 ? 'row' : 'rows'}`),
      h('span.spacer'),
      pages > 1 ? [
        h('button.btn.ghost', { disabled: page === 0, on: { click: () => { page--; render(); } } }, 'Previous'),
        h('span', `${page + 1} / ${pages}`),
        h('button.btn.ghost', { disabled: page >= pages - 1, on: { click: () => { page++; render(); } } }, 'Next'),
      ] : null,
    );
  }
  render();
  return { el, setRows: (r) => { data = r; page = 0; render(); } };
}
