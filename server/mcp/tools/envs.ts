// Environment tools: list (with kind and source) and create a design environment by copying another.

import { copyEnv } from '../../store/env-copy.ts';
import { listEnvMeta } from '../../store/envs.ts';
import { setEnvColor } from '../../store/env-color.ts';
import { ENV_COLORS, envColorName } from '../../../core/env-colors.ts';
import { type Tool, obj } from './common.ts';

export const listEnvsTool: Tool = {
  name: 'list_envs', description: "List environments with their kind ('sealed': filled by harvesters, read-only for manual edits; 'design': created by a copy, editable), the source and date it was copied from, its subsystems (groups) counts and colour (a slot 1..10 with its name; the UI shows it on flow tabs).",
  inputSchema: obj({}),
  run: (c) => listEnvMeta(c.db).map((e) => ({ name: e.name, kind: e.kind, source: e.source, copiedAt: e.copiedAt, groups: e.groups, components: e.counts.components, color: e.color, colorName: envColorName(e.color), colorAuto: e.colorAuto })),
};

export const createEnvTool: Tool = {
  name: 'create_env', description: "Create a design environment by copying another one. mode: 'blank' (nothing copied), 'components' (the listed services with their endpoints, calls, channels, stores, DTOs and schemas; no functions or flows unless behaviour is true) or 'full' (everything of the source, flows included). groups are the subsystems in order [{key, label, about?}]; each listed service may name its groupPath (one of the group keys).",
  inputSchema: obj({
    name: { type: 'string', description: 'Lowercase letters, digits and -' }, source: { type: 'string', description: "The environment to copy from (any kind). Required for 'components' and 'full'; not needed (ignored) for 'blank'" },
    mode: { enum: ['blank', 'components', 'full'] },
    groups: { type: 'array', items: obj({ key: { type: 'string' }, label: { type: 'string' }, about: { type: 'string', description: 'Markdown-lite description of the subsystem, at most 20000 characters' }, owners: { type: 'array', description: 'People who own the subsystem: names or {name?, externalSource, externalId}, matched to users', items: {} } }, ['key', 'label']) },
    levels: { type: 'array', items: { type: 'string' } },
    behaviour: { type: 'boolean', description: "components mode: also copy the services' functions and steps (flows of copied endpoints trace; they are unchanged against the baseline). Default false" },
    entryPoints: { enum: ['keep', 'none'], description: "components / full: 'none' marks every copied ingress entryPoint:false (not listed as an entry point, no marks). Default 'none' for components (#65), 'keep' for full" },
    infraGroupPath: { type: 'string', description: "components mode: subsystem of the synthetic <source>-infra service. Default 'infra'; it need not be one of the groups" },
    services: { type: 'array', items: obj({ name: { type: 'string' }, groupPath: { type: 'string' } }, ['name']) },
  }, ['name', 'mode']),
  run: (c, a) => { const e = copyEnv(c.db, { ...a, createdBy: 'mcp' }); c.changed(e.name); return e; },
};

export const setEnvColorTool: Tool = {
  name: 'set_env_color', description: `Set the colour of an environment (any kind; an annotation, no draft needed): a slot 1..10 (${ENV_COLORS.map((n, i) => `${i + 1} ${n}`).join(', ')}) or null for automatic (follows creation order).`,
  inputSchema: obj({ env: { type: 'string' }, color: { type: ['integer', 'null'], minimum: 1, maximum: 10 } }, ['env', 'color']),
  run: (c, a) => { const out = setEnvColor(c.db, a.env, a.color); c.changed(a.env); return out; },
};
