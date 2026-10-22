// The small pure rules of the Users page (0.32.0), apart from the DOM so a node test can load them. No imports.

/** Activity of a user: what they wrote and were given. */
const act = (u) => (u.counts ? u.counts.comments + u.counts.items + u.counts.mentions : 0);

/** Which of two users should survive a merge by default: the one with external ids, then the one with more activity (a tie keeps `a`). */
export const survivor = (a, b) => ((a.externalIds?.length ?? 0) !== (b.externalIds?.length ?? 0) ? ((a.externalIds?.length ?? 0) > (b.externalIds?.length ?? 0) ? a : b) : act(a) >= act(b) ? a : b);
