// Runtime configuration from environment variables.

import { join } from 'node:path';

const root = join(import.meta.dirname, '..');
const dataDir = process.env.FLOW_DATA_DIR ?? join(root, 'data');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir,
  dbPath: process.env.FLOW_DB ?? join(dataDir, 'flow-mapper.db'),
  dev: process.env.NODE_ENV !== 'production',
};
