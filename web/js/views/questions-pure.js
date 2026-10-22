// The Questions page with no DOM (0.33.0): the link into the pane, the grouping by subsystem, the filter.

/** The query of the System map that opens the pane of a question's item scrolled to it (`question=<index among that item's questions>`). */
export const questionLink = (q) => (q.kind === 'subsystem' ? { level: 'subsystems', sel: `grp:${q.id}`, question: q.index } : { sel: `svc:${q.id}`, question: q.index });

/** Groups by subsystem: the subsystem's own questions and those of its components together, in the order of first appearance; '' is "Not set". */
export function groupQuestions(list, label = (k) => k || 'Not set') {
  const by = new Map();
  for (const q of list) { const k = q.subsystem ?? ''; if (!by.has(k)) by.set(k, []); by.get(k).push(q); }
  return [...by].map(([key, items]) => ({ key, label: label(key), items }));
}

/** Keeps the questions whose item or text contains every word of `text` (case-insensitive). */
export function filterQuestions(list, text) {
  const words = String(text ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  return words.length ? list.filter((q) => words.every((w) => `${q.label} ${q.text}`.toLowerCase().includes(w))) : list;
}

/** A question as plain text for a list row: the Markdown marks (bold, italic, strike, code) and link syntax are out, `@[userId]` stays for the caller to turn into a name. */
export const plainQuestion = (text) => String(text ?? '').replace(/\[([^\]]+)\]\((?:[^)\s]+)\)/g, '$1').replace(/[*_~`]/g, '').trim();
