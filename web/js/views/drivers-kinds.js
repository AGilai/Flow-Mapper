// Store types of the Drivers view: a client row's kind (a store kind, or an egress transport) folds into one picker type.

const LABEL = { redis: 'Redis', mongodb: 'MongoDB', dynamodb: 'DynamoDB', postgres: 'Postgres', mysql: 'MySQL', s3: 'S3', elasticsearch: 'Elasticsearch', http: 'HTTP clients', 'sqs-sns': 'SQS / SNS SDK' };
const FOLD = { 'external-http': 'http', sqs: 'sqs-sns', sns: 'sqs-sns', eventbridge: 'sqs-sns' };
/** Types always offered, dimmed "no data yet" until a harvester reports clients for them. */
export const ALWAYS = ['redis', 'mongodb', 'sqs-sns', 'http'];

export const typeOf = (kind) => FOLD[kind] ?? kind;
export const kindLabel = (k) => LABEL[typeOf(k)] ?? k;
/** Picker order: Redis, MongoDB, other stores with data, then the SDK placeholders. */
export const typeOrder = (types) => [...new Set([...ALWAYS, ...types])].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
const rank = (t) => (t === 'redis' ? 0 : t === 'mongodb' ? 1 : t === 'sqs-sns' ? 8 : t === 'http' ? 9 : 5);
