// Starts the HTTP server (API + MCP at /mcp + web UI).

import { createApp } from './app.ts';
import { config } from './config.ts';

const { server, ctx } = createApp({ dbPath: config.dbPath, dataDir: config.dataDir, dev: config.dev });
server.listen(config.port, config.host, () => {
  console.log(`flow-mapper ${ctx.appVersion} on http://localhost:${config.port}  (db: ${config.dbPath})`);
});
