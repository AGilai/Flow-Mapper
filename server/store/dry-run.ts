// A dry run is the real write inside a transaction that is rolled back at the end: validation, version checks and
// diffs are exactly the real ones, and nothing stays written.

import type { DB } from '../db/connection.ts';
import { tx } from '../db/connection.ts';

/** Thrown at the end of a dry run so the transaction rolls back; carries what the run would have returned. */
export class DryRun extends Error {
  value: unknown;
  constructor(value: unknown) { super('dry run'); this.value = value; }
}

/** Run `fn` in a transaction; with `dryRun`, roll it back and return its result anyway. */
export function withDry<T>(db: DB, dryRun: boolean, fn: () => T): T {
  try {
    return tx(db, () => {
      const v = fn();
      if (dryRun) throw new DryRun(v);
      return v;
    });
  } catch (err) {
    if (err instanceof DryRun) return err.value as T;
    throw err;
  }
}
