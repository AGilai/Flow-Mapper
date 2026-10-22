// The open-questions list (0.33.0, info pane extra 1): every list item of an "Open questions" section (`## Open questions`) in the `about` of the components and
// the subsystems of one environment, in one list. Pure: the server and the preview hand it the rows (draft-aware: the caller reads the draft's view).

import { openQuestions } from './about-sections.ts';

export interface Question {
  kind: 'component' | 'subsystem';
  /** the component name, or the subsystem key */
  id: string;
  /** what to show: the component name, or the subsystem's label */
  label: string;
  /** the subsystem of a component ('' = none), so a list can group by it */
  subsystem: string;
  /** the question as written (Markdown-lite, one line) */
  text: string;
  /** 0-based position among the questions of this item: `?question=<index>` opens the pane scrolled to it */
  index: number;
  /** 0-based line of the item in the about text */
  line: number;
}

/** subsystems first (in the order given), then components by name; each item's questions in the order written. */
export function collectQuestions(
  subsystems: { key: string; label: string; about?: string }[],
  components: { name: string; about?: string; groupPath?: string }[],
): Question[] {
  const out: Question[] = [];
  for (const s of subsystems) openQuestions(s.about).forEach((q, index) => out.push({ kind: 'subsystem', id: s.key, label: s.label || s.key, subsystem: s.key, text: q.text, index, line: q.line }));
  for (const c of [...components].sort((a, b) => a.name.localeCompare(b.name))) {
    const subsystem = typeof c.groupPath === 'string' ? c.groupPath.split('/')[0] : '';
    openQuestions(c.about).forEach((q, index) => out.push({ kind: 'component', id: c.name, label: c.name, subsystem, text: q.text, index, line: q.line }));
  }
  return out;
}
