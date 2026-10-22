// Environment colours: ten slots (--env-1..10 in tokens.css), shown on flow tabs, the env picker and env chips.
// Pure. Shared by the server (new envs take a slot), the browser and the preview build.

export const ENV_COLORS = ['Teal', 'Orange', 'Violet', 'Rose', 'Green', 'Brown', 'Steel', 'Plum', 'Pine', 'Navy'] as const;
export const ENV_SLOTS = ENV_COLORS.length;

/** A slot is an integer 1..10. */
export const isEnvSlot = (n: unknown): n is number => Number.isInteger(n) && (n as number) >= 1 && (n as number) <= ENV_SLOTS;

/** The name of a slot ("Teal"), '' when it is not one. */
export const envColorName = (slot: number): string => (isEnvSlot(slot) ? ENV_COLORS[slot - 1] : '');

/**
 * The slot a new environment takes: the lowest one no other environment holds. Only when all ten are held does it
 * repeat the least used (the lowest on a tie). `taken` is the stored slots (null = automatic, ignored).
 */
export function nextFreeSlot(taken: (number | null | undefined)[]): number {
  const uses = new Array<number>(ENV_SLOTS + 1).fill(0);
  for (const t of taken) if (isEnvSlot(t)) uses[t]++;
  let best = 1;
  for (let s = 1; s <= ENV_SLOTS; s++) if (uses[s] < uses[best]) best = s;
  return best;
}

/** The automatic slot of the environment at `rank` (0-based, creation order, name on a tie). */
export const rankSlot = (rank: number): number => (((rank % ENV_SLOTS) + ENV_SLOTS) % ENV_SLOTS) + 1;

/** The slot to draw: the stored one, else the automatic one by rank. */
export const envSlot = (stored: number | null | undefined, rank: number): number => (isEnvSlot(stored) ? stored : rankSlot(rank));

/** Rank of each name in creation order: `[{name, createdAt}]` -> `{name: rank}`. */
export function envRanks(envs: { name: string; createdAt: string }[]): Record<string, number> {
  const order = [...envs].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return Object.fromEntries(order.map((e, i) => [e.name, i]));
}
