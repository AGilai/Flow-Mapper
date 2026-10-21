// Minimal MCP server over JSON-RPC 2.0: initialize, ping, tools/list, tools/call.
// Transport-agnostic; see http.ts (streamable HTTP, JSON responses) and stdio.ts.

import type { Ctx } from '../context.ts';
import { HttpError } from '../errors.ts';
import { TOOLS } from './tools.ts';

const PROTOCOL = '2025-06-18';
const byName = new Map(TOOLS.map((t) => [t.name, t]));

interface RpcRequest { jsonrpc: '2.0'; id?: string | number | null; method: string; params?: any }

export function handleRpc(ctx: Ctx, msg: RpcRequest): object | null {
  const isNotification = msg.id === undefined || msg.id === null;
  const reply = (result: unknown) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, result });
  const error = (code: number, message: string) => (isNotification ? null : { jsonrpc: '2.0', id: msg.id, error: { code, message } });

  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'invalid request' } };

  switch (msg.method) {
    case 'initialize':
      return reply({
        protocolVersion: PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'flow-mapper', version: ctx.appVersion },
        instructions: 'Flow-Mapper maps service-to-service and in-service call flows. Start with search or list_entry_points, then trace_flow. link_health shows broken links. Report Flow-Mapper problems with report_bug.',
      });
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return null;
    case 'ping':
      return reply({});
    case 'tools/list':
      return reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    case 'tools/call': {
      const tool = byName.get(msg.params?.name);
      if (!tool) return error(-32602, `unknown tool ${msg.params?.name}`);
      const args = msg.params?.arguments ?? {};
      // one check for every tool that takes dryRun: a string like "false" must never read as a real run
      if ((tool.inputSchema as any).properties?.dryRun && args.dryRun !== undefined && args.dryRun !== null && typeof args.dryRun !== 'boolean') return error(-32602, `invalid params: dryRun must be a boolean (true or false), got ${JSON.stringify(args.dryRun)}`);
      try {
        const out = tool.run(ctx, args);
        return reply({ content: [{ type: 'text', text: JSON.stringify(out, null, 1) }], isError: false });
      } catch (err) {
        const text = err instanceof HttpError ? `${err.code}: ${err.message}${err.details ? '\n' + JSON.stringify(err.details) : ''}` : String(err);
        return reply({ content: [{ type: 'text', text }], isError: true });
      }
    }
    default:
      return error(-32601, `method not found: ${msg.method}`);
  }
}
