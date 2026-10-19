// Shared dependencies handed to route modules and MCP tools.

import type { DB } from './db/connection.ts';
import type { GraphIndex } from '../core/graph-index.ts';

export interface Ctx {
  db: DB;
  dataDir: string;
  appVersion: string;
  graph: (env: string) => GraphIndex;
  /** Call after any write to the map in `env`. */
  changed: (env: string) => void;
}
