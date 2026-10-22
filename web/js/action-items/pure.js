// The small pure rules of the action items UI (0.29.0), apart from the DOM so a node test can load them.

// No imports: a node test loads this file as it is (the DOM-free parts of the UI do not reach into core/ from here).
const isOpen = (s) => s === 'open' || s === 'progress';

export const STATUS = { open: 'open', progress: 'in progress', done: 'done', dropped: 'dropped' };
export const CHIP = { open: 'open', progress: 'prog', done: 'done', dropped: 'drop' };

/** The viewer's local date as YYYY-MM-DD. */
export const todayLocal = (now = new Date()) => `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
/** Overdue: due before today (the viewer's local date) and still open or in progress. */
export const isLate = (item, today = todayLocal()) => !!item.due && item.due < today && isOpen(item.status);
/** "Oct 14", with the year when it is not this one: "Oct 14, 2027". */
export function fmtDue(due, today = todayLocal()) {
  const [y, m, d] = String(due).split('-').map(Number);
  if (!y) return '';
  const s = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
  return String(y) === today.slice(0, 4) ? s : `${s}, ${y}`;
}
/** The header counts: "(3 open · 5)". */
export const headerText = (items) => `(${items.filter((i) => isOpen(i.status)).length} open · ${items.length})`;
/** The header while a new row is open and nothing is saved yet: the draft row counts as open. */
export const headerWithDraft = (items) => (items.length ? headerText(items) : '(1 open)');
export const closedOf = (items) => items.filter((i) => !isOpen(i.status));

/** A comment's HTML with its table tags removed (cell text stays, separated by spaces): tables are stripped from the prefill, not drawn as "a | b". */
export const stripTables = (html) => String(html ?? '').replace(/<\/?(?:table|thead|tbody|tr|td|th)\b[^>]*>/gi, ' ');

/** The description a comment becomes, from its plain text (the caller strips the HTML with core's plainText): whitespace collapsed, at most 200 characters with "…" when cut. */
export function prefill(text, max = 200) {
  const t = String(text ?? '').replace(/(^|\n)[ \t]*(?:- |\d+\. )/g, '$1').replace(/\s+/g, ' ').trim(); // list markers at a line start go too
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Names offered as owner: the remembered name first, then the names seen in this flow's comments and items, each once, in order of appearance. */
export function ownerNames({ me = '', comments = [], items = [] }) {
  const seen = [];
  const add = (n) => { const s = String(n ?? '').trim(); if (s && !seen.includes(s)) seen.push(s); };
  add(me);
  const walk = (c) => { add(c.author); (c.replies ?? []).forEach(walk); };
  comments.forEach(walk);
  items.forEach((i) => { add(i.owner); add(i.createdBy); });
  return seen;
}
/** The suggestions for what has been typed: names that contain it (case-insensitive), the typed one itself dropped. */
export const suggest = (names, typed) => { const t = String(typed).trim().toLowerCase(); return names.filter((n) => n.toLowerCase().includes(t) && n.toLowerCase() !== t); };

/** The line under a comment: "Asaf G. created action #4 from this comment", "Dana closed #2", "dropped", "reopened". */
export const eventParts = (e) => (e.kind === 'created' ? { verb: 'created action', tail: ' from this comment' } : { verb: e.kind, tail: '' });
