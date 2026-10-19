// Validators built from schema/manifest.schema.json (the single source of truth).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createValidator, type SchemaError } from '../core/schema-validate.ts';

const schema = JSON.parse(readFileSync(join(import.meta.dirname, '../schema/manifest.schema.json'), 'utf8'));

export const validateManifest = createValidator(schema);

export const LISTS = ['functions', 'ingress', 'egress', 'resources', 'channels', 'bindings'] as const;
export type ListName = (typeof LISTS)[number];
const DEF: Record<ListName, string> = {
  functions: 'function', ingress: 'ingress', egress: 'egress', resources: 'resource', channels: 'channel', bindings: 'binding',
};

const entityValidators = Object.fromEntries(
  LISTS.map((l) => [l, createValidator({ $ref: `#/$defs/${DEF[l]}`, $defs: schema.$defs })]),
) as Record<ListName, (v: unknown) => SchemaError[]>;

export const validateEntity = (list: ListName, v: unknown) => entityValidators[list](v);
export const validateServiceHeader = createValidator({ $ref: '#/$defs/service', $defs: schema.$defs });
export const keyOf = (list: ListName, e: any): string => (list === 'channels' ? e.bindKey : e.id);
export const isList = (x: string): x is ListName => (LISTS as readonly string[]).includes(x);
