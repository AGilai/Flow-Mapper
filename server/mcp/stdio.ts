// MCP over stdio: one JSON-RPC message per line. Run: node server/mcp/stdio.ts
// Uses the same database as the web server (FLOW_DB, default data/flow-mapper.db).

import { createInterface } from 'node:readline';
import { createContext } from '../app.ts';
import { config } from '../config.ts';
import { handleRpc } from './protocol.ts';

const ctx = createContext({ dbPath: config.dbPath, dataDir: config.dataDir });
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg;
  try { msg = JSON.parse(line); }
  catch { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } }) + '\n'); return; }
  const out = handleRpc(ctx, msg);
  if (out) process.stdout.write(JSON.stringify(out) + '\n');
});
