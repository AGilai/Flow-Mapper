// Shared helpers for the MCP tool modules.

import { HttpError } from '../../errors.ts';
import { isList, LISTS } from '../../schema.ts';
import type { Ctx } from '../../context.ts';

export interface Tool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  run: (ctx: Ctx, args: any) => unknown;
}

export const env = { type: 'string', description: "Environment, default 'default'" };
export const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: 'object', properties, required, additionalProperties: false });
export const envOf = (a: any) => a.env ?? 'default';
export const draftArg = { type: 'string', description: 'Open draft slug: read the environment as the draft would leave it' };
/** The graph and the non-graph reader of the environment, or of the environment as the open draft `a.draft` would leave it. */
export const viewOf = (c: Ctx, a: any) => c.view(envOf(a), a.draft || null);
export const listArg = (l: string) => { if (!isList(l)) throw new HttpError(400, 'BAD_REQUEST', `list must be one of ${LISTS.join(', ')}`); return l; };
