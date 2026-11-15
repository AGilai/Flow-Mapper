// Minimal MCP server over JSON-RPC 2.0: initialize, ping, tools/list, tools/call.
// Transport-agnostic; see http.ts (streamable HTTP, JSON responses) and stdio.ts.

import type { Ctx } from '../context.ts';
import { HttpError } from '../errors.ts';
import { TOOLS } from './tools.ts';
import { checkTool } from './access.ts';
import { listEnvMeta } from '../store/envs.ts';
import { readableEnvs } from '../access.ts';

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
        instructions: 'Flow-Mapper maps service-to-service and in-service call flows. If you design with it (HLD/LLD), read AGENTS.md in the Flow-Mapper repo first. The loop: create_env (mode blank) -> open_draft -> edit_in_draft (from scratch) or import_mermaid / apply_import_plan (from documents) -> draft_changes -> export_mermaid -> apply_draft (dryRun first) -> share_env. Every tool that takes env needs it (no default; a missing one lists your envs); sealed (harvested) envs are read-only (403 SEALED); an env you cannot see answers 404. To read a map: search or list_entry_points, then trace_flow; link_health shows broken links. Report Flow-Mapper problems with report_bug.',
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
        if (((tool.inputSchema as any).required as string[]).includes('env') && !(typeof args.env === 'string' && args.env)) {
          const ok = readableEnvs(ctx.db), names = listEnvMeta(ctx.db).map((e) => e.name).filter((n) => !ok || ok.has(n));
          throw new HttpError(400, 'BAD_REQUEST', `env is required: pass one of your environments (${names.join(', ') || 'none yet: create_env makes one'}); there is no default`, { envs: names });
        }
        checkTool(ctx, tool, args); // accounts: the REST rules for the token's user (no-op with auth off)
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
