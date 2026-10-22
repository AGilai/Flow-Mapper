// Starts the HTTP server (API + MCP at /mcp + web UI).

import { createApp } from './app.ts';
import { config } from './config.ts';

const { server, ctx } = createApp({ dbPath: config.dbPath, dataDir: config.dataDir, dev: config.dev });
// Keep the planner statistics current (cheap: it only analyses what changed a lot).
setInterval(() => { try { ctx.db.exec('PRAGMA optimize'); } catch (e) { console.error('flow-mapper: PRAGMA optimize failed', e); } }, 3_600_000).unref();
server.listen(config.port, config.host, () => {
  console.log(`flow-mapper ${ctx.appVersion} on http://localhost:${config.port}  (db: ${config.dbPath})`);
});
