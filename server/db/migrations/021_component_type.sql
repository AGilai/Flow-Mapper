-- Component type (0.68.0, frame 34): the one `type` field of a service header (core/component-types.ts). ADDITIVE ONLY.
-- A service header whose `details.icon` is a built-in name (the 0.65 - 0.67 icons) and that has no `type` gets `type` added: the same id, except vault -> hashicorp-vault
-- (core/component-types.ts `legacyType`; aws-ec2 and aws-iam have no catalogue type and stay as they are). `details.icon` and `details.product` are NEVER removed or changed:
-- an older server (0.67.0) still draws the same data. Custom SVG / data-URL icons and product text are left alone (scripts/type-report.ts lists them).
-- Headers live in snapshots.meta (JSON, current snapshot) and in draft_ops (list = 'header', op = 'upsert', whole item in data). Subsystem items (list = 'subsystem') have an
-- `icon` key of their own: not touched. Rows whose JSON is invalid are skipped.

UPDATE snapshots
   SET meta = json_set(meta, '$.type', CASE json_extract(meta, '$.details.icon') WHEN 'vault' THEN 'hashicorp-vault' ELSE json_extract(meta, '$.details.icon') END)
 WHERE json_valid(meta) AND json_type(meta, '$.type') IS NULL
   AND json_extract(meta, '$.details.icon') IN ('vault', 'auth0', 'mongodb', 'redis', 'postgres', 'mysql', 'elasticsearch', 'rabbitmq', 'kafka', 'aws-lambda', 'aws-ecs', 'aws-eks', 'aws-sqs', 'aws-sns', 'aws-eventbridge', 'aws-step-functions', 'aws-dynamodb', 'aws-rds', 'aws-elasticache', 'aws-s3', 'aws-api-gateway', 'aws-cloudfront', 'aws-kinesis', 'aws-cognito', 'aws-kms', 'aws-secrets-manager');

UPDATE draft_ops
   SET data = json_set(data, '$.type', CASE json_extract(data, '$.details.icon') WHEN 'vault' THEN 'hashicorp-vault' ELSE json_extract(data, '$.details.icon') END)
 WHERE op = 'upsert' AND list = 'header' AND data IS NOT NULL AND json_valid(data) AND json_type(data, '$.type') IS NULL
   AND json_extract(data, '$.details.icon') IN ('vault', 'auth0', 'mongodb', 'redis', 'postgres', 'mysql', 'elasticsearch', 'rabbitmq', 'kafka', 'aws-lambda', 'aws-ecs', 'aws-eks', 'aws-sqs', 'aws-sns', 'aws-eventbridge', 'aws-step-functions', 'aws-dynamodb', 'aws-rds', 'aws-elasticache', 'aws-s3', 'aws-api-gateway', 'aws-cloudfront', 'aws-kinesis', 'aws-cognito', 'aws-kms', 'aws-secrets-manager');
