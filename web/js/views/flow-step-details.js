// Step details on the arrows (0.30.0): what each step of the top lane shows besides its API line, from the description store.
// createStepDetails({ store, root, opts }) -> { forLane(built, messages) -> { parts: Map(event -> arrowParts), text: Map(event -> {title, desc, who, key, n}) } | null }
// null when the arrows show the API only (the layout is then exactly the one of 0.29), or when the flow has no descriptions (function tab, sub-flow).

import { stepKeys, titleOf, lineText } from '../../core/description.js';
import { stepsOf } from './flow-steps.js';
import { arrowParts } from './step-details-pure.js';

/** The title, description and author kind of a step key from a descriptions record (empty strings and null when there is none). */
export function stepText(data, key) {
  const p = data?.callees?.[key] ?? null, l = lineText(p);
  return { title: titleOf(p), desc: l?.text ?? '', who: l?.who ?? null, outdated: !!l?.outdated };
}

export function createStepDetails({ store, root, opts }) {
  return {
    forLane(built, messages) {
      if (!root || opts.sd === 'a') return null;
      const data = store.peek(root), parts = new Map(), text = new Map();
      for (const st of stepsOf(built, stepKeys, messages)) {
        const t = stepText(data, st.key);
        parts.set(st.event, arrowParts(opts.sd, t));
        text.set(st.event, { ...t, key: st.key, n: st.n });
      }
      return { parts, text };
    },
  };
}
