// Store types of the Drivers view: a client row's kind (a store kind, or an egress transport) folds into one picker type.

const LABEL: Record<string, string> = { redis: 'Redis', mongodb: 'MongoDB', dynamodb: 'DynamoDB', postgres: 'Postgres', mysql: 'MySQL', s3: 'S3', elasticsearch: 'Elasticsearch', http: 'HTTP clients', 'sqs-sns': 'SQS / SNS SDK' };
const FOLD: Record<string, string> = { 'external-http': 'http', sqs: 'sqs-sns', sns: 'sqs-sns', eventbridge: 'sqs-sns' };

export const typeOf = (kind: string): string => FOLD[kind] ?? kind;
export const kindLabel = (k: string): string => LABEL[typeOf(k)] ?? k;
