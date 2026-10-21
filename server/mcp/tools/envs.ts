// Environment tools: list (with kind and source) and create a design environment by copying another.

import { copyEnv } from '../../store/env-copy.ts';
import { listEnvMeta } from '../../store/envs.ts';
import { type Tool, obj } from './common.ts';

export const listEnvsTool: Tool = {
  name: 'list_envs', description: "List environments with their kind ('sealed': filled by harvesters, read-only for manual edits; 'design': created by a copy, editable), the source and date it was copied from, its subsystems (groups) and counts.",
  inputSchema: obj({}),
  run: (c) => listEnvMeta(c.db).map((e) => ({ name: e.name, kind: e.kind, source: e.source, copiedAt: e.copiedAt, groups: e.groups, components: e.counts.components })),
};

export const createEnvTool: Tool = {
  name: 'create_env', description: "Create a design environment by copying another one. mode: 'blank' (nothing copied), 'components' (the listed services with their endpoints, calls, channels, stores, DTOs and schemas; no functions or flows unless behaviour is true) or 'full' (everything of the source, flows included). groups are the subsystems in order [{key, label}]; each listed service may name its groupPath (one of the group keys).",
  inputSchema: obj({
    name: { type: 'string', description: 'Lowercase letters, digits and -' }, source: { type: 'string', description: 'The environment to copy from (any kind)' },
    mode: { enum: ['blank', 'components', 'full'] },
    groups: { type: 'array', items: obj({ key: { type: 'string' }, label: { type: 'string' } }, ['key', 'label']) },
    levels: { type: 'array', items: { type: 'string' } },
    behaviour: { type: 'boolean', description: "components mode: also copy the services' functions and steps (flows of copied endpoints trace; they are unchanged against the baseline). Default false" },
    services: { type: 'array', items: obj({ name: { type: 'string' }, groupPath: { type: 'string' } }, ['name']) },
  }, ['name', 'source', 'mode']),
  run: (c, a) => { const e = copyEnv(c.db, { ...a, createdBy: 'mcp' }); c.changed(e.name); return e; },
};
