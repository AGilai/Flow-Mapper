// MCP over streamable HTTP (JSON response mode): POST /mcp with one JSON-RPC message.

import type { Router } from '../http/router.ts';
import { Reply } from '../http/router.ts';
import type { Ctx } from '../context.ts';
import { handleRpc } from './protocol.ts';

export function registerMcpHttp(r: Router, ctx: Ctx) {
  r.post('/mcp', async (req) => {
    const out = handleRpc(ctx, await req.json());
    return out ? out : new Reply(202, '');
  });
  r.get('/mcp', () => new Reply(405, JSON.stringify({ error: 'SSE stream not supported; POST JSON-RPC messages' }), { 'content-type': 'application/json', allow: 'POST' }));
}
