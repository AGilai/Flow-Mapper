// The component type catalogue for the browser (frame 34, 0.68.0): a mirror of core/component-types.ts with no imports, so every view and node test can load it
// (tests/component-types.test.ts keeps the two equal). A type is [id, label, generic parent, icon file (web/icons/, no .svg), search keywords].
const GENERIC = [
  ['service', 'Service', 'service', 'generic/Res_Generic-Application_48', 'application component'],
  ['idp', 'IDP', 'idp', 'generic/Res_Authenticated-User_48', 'identity provider login auth users'],
  ['vault', 'Vault', 'vault', 'generic/Res_Credentials_48', 'secrets keys'],
  ['database', 'Database', 'database', 'generic/Res_Database_48', 'sql nosql db'],
  ['cache', 'Cache', 'cache', 'generic/Res_Data-Table_48', 'key value in-memory'],
  ['queue', 'Queue', 'queue', 'generic/Res_Data-Stream_48', 'stream broker messaging'],
  ['topic', 'Topic', 'topic', 'generic/Res_Forums_48', 'events pubsub messaging notification'],
  ['storage', 'Storage', 'storage', 'generic/Res_Folder_48', 'bucket object files'],
  ['search', 'Search', 'search', 'generic/Res_Magnifying-Glass_48', 'index'],
  ['function', 'Function', 'function', 'generic/Res_Source-Code_48', 'serverless lambda'],
  ['container', 'Container', 'container', 'generic/Res_Servers_48', 'kubernetes docker cluster'],
  ['gateway', 'Gateway', 'gateway', 'generic/Res_Internet_48', 'api http proxy'],
  ['cdn', 'CDN', 'cdn', 'generic/Res_Globe_48', 'edge'],
  ['workflow', 'Workflow', 'workflow', 'generic/Res_Gear_48', 'orchestration state machine'],
];
const SPECIFIC = [
  ['auth0', 'Auth0', 'idp', 'auth0', 'oauth login'],
  ['aws-cognito', 'Amazon Cognito', 'idp', 'aws-cognito', 'users login'],
  ['hashicorp-vault', 'HashiCorp Vault', 'vault', 'vault', 'secrets'],
  ['aws-secrets-manager', 'AWS Secrets Manager', 'vault', 'aws-secrets-manager', ''],
  ['aws-kms', 'AWS KMS', 'vault', 'aws-kms', 'keys encryption'],
  ['postgres', 'PostgreSQL', 'database', 'postgres', 'sql relational'],
  ['mysql', 'MySQL', 'database', 'mysql', 'sql relational'],
  ['mongodb', 'MongoDB', 'database', 'mongodb', 'nosql document'],
  ['aws-dynamodb', 'Amazon DynamoDB', 'database', 'aws-dynamodb', 'nosql'],
  ['aws-rds', 'Amazon RDS', 'database', 'aws-rds', 'sql relational'],
  ['redis', 'Redis', 'cache', 'redis', 'key value'],
  ['aws-elasticache', 'Amazon ElastiCache', 'cache', 'aws-elasticache', 'redis memcached'],
  ['kafka', 'Apache Kafka', 'queue', 'kafka', 'stream broker'],
  ['rabbitmq', 'RabbitMQ', 'queue', 'rabbitmq', 'broker amqp'],
  ['aws-sqs', 'Amazon SQS', 'queue', 'aws-sqs', ''],
  ['aws-kinesis', 'Amazon Kinesis', 'queue', 'aws-kinesis', 'stream'],
  ['aws-sns', 'Amazon SNS', 'topic', 'aws-sns', 'pubsub notification'],
  ['aws-eventbridge', 'Amazon EventBridge', 'topic', 'aws-eventbridge', 'event bus'],
  ['aws-s3', 'Amazon S3', 'storage', 'aws-s3', 'bucket'],
  ['elasticsearch', 'Elasticsearch', 'search', 'elasticsearch', ''],
  ['aws-lambda', 'AWS Lambda', 'function', 'aws-lambda', 'serverless'],
  ['aws-ecs', 'Amazon ECS', 'container', 'aws-ecs', ''],
  ['aws-eks', 'Amazon EKS', 'container', 'aws-eks', 'kubernetes'],
  ['kubernetes', 'Kubernetes', 'container', 'kubernetes', 'k8s'],
  ['aws-api-gateway', 'Amazon API Gateway', 'gateway', 'aws-api-gateway', 'api http'],
  ['aws-cloudfront', 'Amazon CloudFront', 'cdn', 'aws-cloudfront', ''],
  ['aws-step-functions', 'AWS Step Functions', 'workflow', 'aws-step-functions', 'state machine'],
];
export const LEGACY_ICONS = ["vault","auth0","mongodb","redis","postgres","mysql","elasticsearch","rabbitmq","kafka","aws-lambda","aws-ec2","aws-ecs","aws-eks","aws-sqs","aws-sns","aws-eventbridge","aws-step-functions","aws-dynamodb","aws-rds","aws-elasticache","aws-s3","aws-api-gateway","aws-cloudfront","aws-kinesis","aws-cognito","aws-kms","aws-secrets-manager","aws-iam"];

const mk = ([id, label, generic, icon, keywords]) => ({ id, label, generic, icon, keywords });
export const GENERIC_TYPES = GENERIC.map(mk), SPECIFIC_TYPES = SPECIFIC.map(mk), TYPES = [...GENERIC_TYPES, ...SPECIFIC_TYPES];
const BY_ID = new Map(TYPES.map((t) => [t.id, t]));

export const typeInfo = (id) => (typeof id === 'string' ? BY_ID.get(id) ?? null : null);
export const isGeneric = (id) => BY_ID.get(id)?.generic === id;
export const typeLabel = (id) => BY_ID.get(id)?.label ?? id;
export const specificsOf = (generic) => SPECIFIC_TYPES.filter((t) => t.generic === generic);
export const legacyType = (icon) => { if (typeof icon !== 'string') return null; const id = icon === 'vault' ? 'hashicorp-vault' : icon; return LEGACY_ICONS.includes(icon) && BY_ID.has(id) ? id : null; };
const KIND_TYPE = { lambda: 'aws-lambda', gateway: 'aws-api-gateway' };
export const STORE_TYPE = { dynamodb: 'aws-dynamodb', s3: 'aws-s3', redis: 'redis', mongodb: 'mongodb', postgres: 'postgres', mysql: 'mysql', elasticsearch: 'elasticsearch' };
export const CHANNEL_TYPE = { 'sns-topic': 'aws-sns', 'sqs-queue': 'aws-sqs', 'eventbridge-bus': 'aws-eventbridge', 'amqp-exchange': 'rabbitmq', 'amqp-queue': 'rabbitmq', 'rpc-command-queue': 'rabbitmq', 'rpc-reply-queue': 'rabbitmq', 'rpc-reply-queues': 'rabbitmq' };

const res = (id, source, unknown) => ({ id, generic: BY_ID.get(id).generic, source, ...(unknown ? { unknown } : {}) });
/** The type of a header ({ type?, kind?, details? }): declared, else the legacy icon, else the kind, else `service` (the same as core `resolveType`). */
/** An API output carries the resolved `type` and `typeSource` (and `declaredType`, the stored value): read it back as the stored header, so the browser resolves the same way. */
const headerOf = (x) => (x?.typeSource && x.typeSource !== 'declared' ? { ...x, type: x.declaredType } : x);
export function resolveType(c0) {
  const c = headerOf(c0);
  const d = typeof c?.type === 'string' ? c.type.trim() : '';
  if (d && BY_ID.has(d)) return res(d, 'declared');
  const unknown = d || undefined, l = legacyType(c?.details?.icon);
  if (l) return res(l, 'legacy-icon', unknown);
  const k = KIND_TYPE[c?.kind];
  return k ? res(k, 'kind', unknown) : res('service', 'default', unknown);
}

/** 'slate' (Vault), 'white-dark' (Kafka, MySQL: white in dark mode only) or null. */
export const typeTile = (id) => (id === 'hashicorp-vault' ? 'slate' : id === 'kafka' || id === 'mysql' ? 'white-dark' : null);

/** The icon URL (relative to web/) of a type: a generic one has a Light file (dark ink) and a Dark file (white ink) by theme; null for an unknown id. */
export function typeSrc(id, dark = false, base = 'icons/') {
  const t = BY_ID.get(id);
  return !t ? null : t.generic === t.id ? `${base}${t.icon}_${dark ? 'Dark' : 'Light'}.svg` : `${base}${t.icon}.svg`;
}

export function searchTypes(q) {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (t) => { const hay = `${t.id} ${t.label} ${t.keywords ?? ''} ${t.generic === t.id ? '' : `${typeLabel(t.generic)} ${t.generic}`}`.toLowerCase(); return words.every((w) => hay.includes(w)); };
  return { generic: GENERIC_TYPES.filter(hit), specific: SPECIFIC_TYPES.filter(hit) };
}

/** The type a lifeline head draws for a store or channel head, or null (then the head keeps its glyph). */
export const storeTypeOf = (storeKind) => STORE_TYPE[storeKind] ?? null;
export const channelTypeOf = (kind) => CHANNEL_TYPE[kind] ?? null;
