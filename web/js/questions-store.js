// How many open questions the environment has (0.33.0): the rail's "Questions (n)" badge. Read again on every page (a draft edit redraws the page, so the number follows it).
// Only a design environment has the list in the rail; a sealed one answers 0 without a request.

import { api } from './api.js';
import { state, isDesign } from './state.js';

let n = 0, seq = 0;
const subs = new Set();

export const questionCount = () => n;
export const onQuestions = (f) => { subs.add(f); return () => subs.delete(f); };

export async function refreshQuestions() {
  const mine = ++seq;
  if (!isDesign()) { if (n) { n = 0; subs.forEach((f) => f(n)); } return; }
  try {
    const r = await api.openQuestions(state.env);
    if (mine === seq && r.count !== n) { n = r.count; subs.forEach((f) => f(n)); }
  } catch { /* the badge is optional */ }
}
