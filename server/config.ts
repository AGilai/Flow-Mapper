// Runtime configuration from environment variables.

import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dataDir = process.env.FLOW_DATA_DIR ?? join(root, 'data');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir,
  dbPath: process.env.FLOW_DB ?? join(dataDir, 'flow-mapper.db'),
  /** Most environments whose resolved graph stays cached (LRU); env FLOW_GRAPH_CACHE_MAX, default 8. */
  graphCacheMax: Math.max(1, Math.floor(Number(process.env.FLOW_GRAPH_CACHE_MAX)) || 8),
  /** Weight budget of the graph cache: functions + ingress + egress over every cached graph (about 100k per 1,000-service graph, roughly 140 MB RSS each); env FLOW_GRAPH_CACHE_ITEMS, default 250000. */
  graphCacheItems: Math.max(1, Math.floor(Number(process.env.FLOW_GRAPH_CACHE_ITEMS)) || 250_000),
  dev: process.env.NODE_ENV !== 'production',
};
