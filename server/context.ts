// Shared dependencies handed to route modules and MCP tools.

import type { DB } from './db/connection.ts';
import type { GraphIndex } from '../core/graph-index.ts';
import type { DataReader } from './draft-reader.ts';

/** What a route needs to say which environment (and optionally which draft of it) to read. */
export interface EnvReq { params: Record<string, string>; query: URLSearchParams }
export interface Ctx {
  db: DB;
  dataDir: string;
  appVersion: string;
  /** The graph of a sealed or design environment as stored (no draft). Writers and tools that never take `?draft=` use this. */
  graph: (env: string) => GraphIndex;
  /** The graph for a request: `?draft=<slug>` reads the environment as that open draft would leave it. */
  graphOf: (req: EnvReq) => GraphIndex;
  /** DTOs, event DTOs, schemas, flow texts and service rows for a request (database, or the draft's overlay). */
  readerOf: (req: EnvReq) => DataReader;
  view: (env: string, draft?: string | null) => { g: GraphIndex; reader: DataReader };
  /** Call after any write to the map in `env`. */
  changed: (env: string) => void;
  /** Call after a draft's ops change (or it is closed): drops that draft's cached view. */
  changedDraft: (env: string, slug: string) => void;
}
