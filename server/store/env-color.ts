// The colour slot of an environment (envs.color, core/env-colors.ts): taken at creation, set by hand, NULL = automatic.

import type { DB } from '../db/connection.ts';
import { invalid, notFound } from '../errors.ts';
import { isEnvSlot, nextFreeSlot, envColorName } from '../../core/env-colors.ts';
import { envUpdated } from '../events/emitters.ts';

/** The slot a new environment takes: the lowest free among the stored ones (a copy never inherits its source's). */
export function newEnvSlot(db: DB): number {
  return nextFreeSlot((db.prepare('SELECT color FROM envs').all() as { color: number | null }[]).map((r) => r.color));
}

/** Set the colour by hand (1..10) or back to automatic (null). */
export function setEnvColor(db: DB, env: string, color: unknown) {
  if (!db.prepare('SELECT 1 FROM envs WHERE name = ?').get(env)) throw notFound(`environment '${env}'`);
  if (color !== null && !isEnvSlot(color)) throw invalid('color must be a whole number from 1 to 10, or null for automatic', { field: 'color' });
  db.prepare('UPDATE envs SET color = ? WHERE name = ?').run(color, env);
  envUpdated(db, env, 'color');
  return { env, color, colorAuto: color === null, colorName: color === null ? null : envColorName(color as number) };
}
