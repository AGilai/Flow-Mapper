// Component types (CR frame 34, 0.68.0): the one `type` field of a service header. Two levels: a GENERIC type (service, idp, vault, ...) says what the component is
// and shows an AWS General icon; a SPECIFIC type belongs to exactly one generic parent (auth0 -> idp) and shows the product's official logo.
// `resolveType(component)` is the one reader: declared `type` -> legacy `details.icon` (a built-in name) -> `kind` -> `service`.
// Pure. The browser cannot import this file from the view modules that node tests load, so `web/js/components/type-info.js` mirrors the data
// (tests/component-types.test.ts keeps the two equal).

export interface TypeInfo { id: string; label: string; generic: string; /** a file of web/icons/ without .svg (a generic type: the two theme files share this base: `<base>_Light.svg` / `<base>_Dark.svg`) */ icon: string; keywords?: string }
export type TypeSource = 'declared' | 'legacy-icon' | 'kind' | 'default';
export interface ResolvedType { id: string; generic: string; source: TypeSource; /** a declared `type` that is not in the catalogue (kept as stored, never drawn) */ unknown?: string }

const g = (id: string, label: string, base: string, keywords = ''): TypeInfo => ({ id, label, generic: id, icon: `generic/Res_${base}_48`, keywords });
/** The 14 generic types, in picker order. */
export const GENERIC_TYPES: TypeInfo[] = [
  g('service', 'Service', 'Generic-Application', 'application component'), g('idp', 'IDP', 'Authenticated-User', 'identity provider login auth users'), g('vault', 'Vault', 'Credentials', 'secrets keys'),
  g('database', 'Database', 'Database', 'sql nosql db'), g('cache', 'Cache', 'Data-Table', 'key value in-memory'), g('queue', 'Queue', 'Data-Stream', 'stream broker messaging'),
  g('topic', 'Topic', 'Forums', 'events pubsub messaging notification'), g('storage', 'Storage', 'Folder', 'bucket object files'), g('search', 'Search', 'Magnifying-Glass', 'index'),
  g('function', 'Function', 'Source-Code', 'serverless lambda'), g('container', 'Container', 'Servers', 'kubernetes docker cluster'), g('gateway', 'Gateway', 'Internet', 'api http proxy'),
  g('cdn', 'CDN', 'Globe', 'edge'), g('workflow', 'Workflow', 'Gear', 'orchestration state machine'),
];
const s = (id: string, label: string, generic: string, icon = id, keywords = ''): TypeInfo => ({ id, label, generic, icon, keywords });
/** The specific types (each with its generic parent), in picker order. */
export const SPECIFIC_TYPES: TypeInfo[] = [
  s('auth0', 'Auth0', 'idp', 'auth0', 'oauth login'), s('aws-cognito', 'Amazon Cognito', 'idp', 'aws-cognito', 'users login'),
  s('hashicorp-vault', 'HashiCorp Vault', 'vault', 'vault', 'secrets'), s('aws-secrets-manager', 'AWS Secrets Manager', 'vault'), s('aws-kms', 'AWS KMS', 'vault', 'aws-kms', 'keys encryption'),
  s('postgres', 'PostgreSQL', 'database', 'postgres', 'sql relational'), s('mysql', 'MySQL', 'database', 'mysql', 'sql relational'), s('mongodb', 'MongoDB', 'database', 'mongodb', 'nosql document'),
  s('aws-dynamodb', 'Amazon DynamoDB', 'database', 'aws-dynamodb', 'nosql'), s('aws-rds', 'Amazon RDS', 'database', 'aws-rds', 'sql relational'),
  s('redis', 'Redis', 'cache', 'redis', 'key value'), s('aws-elasticache', 'Amazon ElastiCache', 'cache', 'aws-elasticache', 'redis memcached'),
  s('kafka', 'Apache Kafka', 'queue', 'kafka', 'stream broker'), s('rabbitmq', 'RabbitMQ', 'queue', 'rabbitmq', 'broker amqp'), s('aws-sqs', 'Amazon SQS', 'queue', 'aws-sqs'), s('aws-kinesis', 'Amazon Kinesis', 'queue', 'aws-kinesis', 'stream'),
  s('aws-sns', 'Amazon SNS', 'topic', 'aws-sns', 'pubsub notification'), s('aws-eventbridge', 'Amazon EventBridge', 'topic', 'aws-eventbridge', 'event bus'),
  s('aws-s3', 'Amazon S3', 'storage', 'aws-s3', 'bucket'), s('elasticsearch', 'Elasticsearch', 'search', 'elasticsearch'),
  s('aws-lambda', 'AWS Lambda', 'function', 'aws-lambda', 'serverless'),
  s('aws-ecs', 'Amazon ECS', 'container', 'aws-ecs'), s('aws-eks', 'Amazon EKS', 'container', 'aws-eks', 'kubernetes'), s('kubernetes', 'Kubernetes', 'container', 'kubernetes', 'k8s'),
  s('aws-api-gateway', 'Amazon API Gateway', 'gateway', 'aws-api-gateway', 'api http'), s('aws-cloudfront', 'Amazon CloudFront', 'cdn', 'aws-cloudfront'), s('aws-step-functions', 'AWS Step Functions', 'workflow', 'aws-step-functions', 'state machine'),
];
export const TYPES: TypeInfo[] = [...GENERIC_TYPES, ...SPECIFIC_TYPES];
const BY_ID = new Map(TYPES.map((t) => [t.id, t]));

export const typeInfo = (id: unknown): TypeInfo | null => (typeof id === 'string' ? BY_ID.get(id) ?? null : null);
export const isGeneric = (id: string): boolean => BY_ID.get(id)?.generic === id;
export const typeLabel = (id: string): string => BY_ID.get(id)?.label ?? id;
/** The specific types of one generic type. */
export const specificsOf = (generic: string): TypeInfo[] => SPECIFIC_TYPES.filter((t) => t.generic === generic);

/** The legacy `details.icon` built-in names (0.65 - 0.67, CR #144): a name here is read as a type. `aws-ec2` and `aws-iam` had icons but no type in the catalogue. */
export const LEGACY_ICONS: string[] = ['vault', 'auth0', 'mongodb', 'redis', 'postgres', 'mysql', 'elasticsearch', 'rabbitmq', 'kafka', 'aws-lambda', 'aws-ec2', 'aws-ecs', 'aws-eks', 'aws-sqs', 'aws-sns', 'aws-eventbridge', 'aws-step-functions',
  'aws-dynamodb', 'aws-rds', 'aws-elasticache', 'aws-s3', 'aws-api-gateway', 'aws-cloudfront', 'aws-kinesis', 'aws-cognito', 'aws-kms', 'aws-secrets-manager', 'aws-iam'];
/** The type a legacy built-in icon name maps to, or null (an SVG, a data URL, an unknown name, aws-ec2, aws-iam). */
export const legacyType = (icon: unknown): string | null => { if (typeof icon !== 'string') return null; const id = icon === 'vault' ? 'hashicorp-vault' : icon; return LEGACY_ICONS.includes(icon) && BY_ID.has(id) ? id : null; };
const KIND_TYPE: Record<string, string> = { lambda: 'aws-lambda', gateway: 'aws-api-gateway' };
/** A store's driver kind (`storeKind`) and a channel's kind (`ch:` node kind) -> the type whose logo the lifeline head draws. */
export const STORE_TYPE: Record<string, string> = { dynamodb: 'aws-dynamodb', s3: 'aws-s3', redis: 'redis', mongodb: 'mongodb', postgres: 'postgres', mysql: 'mysql', elasticsearch: 'elasticsearch' };
export const CHANNEL_TYPE: Record<string, string> = { 'sns-topic': 'aws-sns', 'sqs-queue': 'aws-sqs', 'eventbridge-bus': 'aws-eventbridge', 'amqp-exchange': 'rabbitmq', 'amqp-queue': 'rabbitmq', 'rpc-command-queue': 'rabbitmq', 'rpc-reply-queue': 'rabbitmq', 'rpc-reply-queues': 'rabbitmq' };

const res = (id: string, source: TypeSource, unknown?: string): ResolvedType => ({ id, generic: BY_ID.get(id)!.generic, source, ...(unknown ? { unknown } : {}) });
/** The type of a component header ({ type?, kind?, details? }): declared, else the legacy icon, else the kind, else `service`. An unknown declared value is reported in `unknown` and left out of the chain. */
export function resolveType(c: any): ResolvedType {
  const d = typeof c?.type === 'string' ? c.type.trim() : '';
  if (d && BY_ID.has(d)) return res(d, 'declared');
  const unknown = d || undefined;
  const l = legacyType(c?.details?.icon);
  if (l) return res(l, 'legacy-icon', unknown);
  const k = KIND_TYPE[c?.kind];
  return k ? res(k, 'kind', unknown) : res('service', 'default', unknown);
}

/** The tile behind a specific mark (frame 32/34): Vault slate; Kafka and MySQL white in dark mode only; a generic type draws theme-swapped files, no tile. */
export const typeTile = (id: string): 'slate' | 'white-dark' | null => (id === 'hashicorp-vault' ? 'slate' : id === 'kafka' || id === 'mysql' ? 'white-dark' : null);

/** The picker's choices for a search text: generic types whose id, label or keywords match, and specific types likewise (also by their parent's label). Every word must match. */
export function searchTypes(q: string): { generic: TypeInfo[]; specific: TypeInfo[] } {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (t: TypeInfo) => { const hay = `${t.id} ${t.label} ${t.keywords ?? ''} ${t.generic === t.id ? '' : `${typeLabel(t.generic)} ${t.generic}`}`.toLowerCase(); return words.every((w) => hay.includes(w)); };
  return { generic: GENERIC_TYPES.filter(hit), specific: SPECIFIC_TYPES.filter(hit) };
}

/** The `type` to add when a header has a built-in `details.icon` and no `type` (the additive normalisation of ingest, import and the migration), or null. */
export const additiveType = (c: any): string | null => (typeof c?.type === 'string' && c.type.trim() ? null : legacyType(c?.details?.icon));

/** The header with `type` added when it has a built-in `details.icon` and no `type`; the old fields stay. The same object when nothing is added. */
export const withType = <T extends object>(c: T): T => { const t = additiveType(c); return t ? { ...c, type: t } : c; };

/** What REST and MCP add to a component they describe: `type` (the resolved id), `typeSource` (declared | legacy-icon | kind | default) and, when the stored `type` is not what it resolved to, `declaredType` (the stored value). */
export const typeFields = (c: any): { type: string; typeSource: TypeSource; declaredType?: string } => {
  const r = resolveType(c), d = typeof c?.type === 'string' && c.type.trim() ? c.type : null;
  return { type: r.id, typeSource: r.source, ...(d && d !== r.id ? { declaredType: d } : {}) };
};
export const withTypeFields = <T extends object>(c: T): T & ReturnType<typeof typeFields> => ({ ...c, ...typeFields(c) });

/** A header read back from REST / MCP (with `type` resolved, `typeSource`, `declaredType`) and written again: the stored form. A resolved `type` that was not declared is dropped, the stored value comes back from `declaredType`. */
export function storedHeader<T extends Record<string, any>>(c: T): T {
  if (c.typeSource === undefined && c.declaredType === undefined) return c;
  const { typeSource, declaredType, ...rest } = c as Record<string, any>;
  if (typeSource !== undefined && typeSource !== 'declared') { if (declaredType !== undefined) rest.type = declaredType; else delete rest.type; }
  return rest as T;
}
