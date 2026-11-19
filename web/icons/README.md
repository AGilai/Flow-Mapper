# Icons

All files are the vendors' own marks, unmodified downloads except `auth0.svg` (see below). Vendor logos are trademarks of their owners and are shown only to identify the product.
Component icons (CR #144, `details.icon`, built-in names listed in `core/component-icons.ts`) and the product icons by object type (`web/js/components/object-icon.js`) use the same files.

| Files | Source | Terms |
|---|---|---|
| `aws-*.svg` (service icons: lambda, ec2, ecs, eks, sqs, sns, eventbridge, step-functions, dynamodb, rds, elasticache, s3, api-gateway, cloudfront, kinesis, cognito, kms, secrets-manager, iam; plus `aws-event.svg` for event types) | Official AWS Architecture Icons, Icon-package_07312026, `Architecture-Service-Icons/Arch_<Category>/48/Arch_<Service>_48.svg`. https://aws.amazon.com/architecture/icons/ | Provided by AWS for depicting AWS services in architecture diagrams; use per the terms on that page (no modification, no implied endorsement). |
| `vault.svg` | Devicon v2.16.0 `icons/vault/vault-original.svg`, https://github.com/devicons/devicon | Devicon is MIT; the Vault logo is a HashiCorp trademark. |
| `kafka.svg` | Devicon v2.16.0 `icons/apachekafka/apachekafka-original.svg` | MIT; Apache Kafka is a trademark of the Apache Software Foundation. |
| `mongodb.svg`, `redis.svg`, `postgres.svg`, `rabbitmq.svg` | Devicon 2.16.0 `*-original.svg` | MIT; trademarks of their owners. |
| `mysql.svg`, `elasticsearch.svg` | Devicon v2.16.0 `icons/mysql/mysql-original.svg`, `icons/elasticsearch/elasticsearch-original.svg` (the official marks; since 0.65 these replace the hand-drawn stand-ins of 0.27.3) | MIT; trademarks of their owners. |
| `auth0.svg` | simple-icons 11.14.0 `icons/auth0.svg`, https://github.com/simple-icons/simple-icons (Devicon has no Auth0 icon). The source is a single colourless path; the only change is `fill="#EB5424"` (Auth0's brand orange) on that path, so it ships as a coloured SVG like the others. | CC0 1.0 for the file; Auth0 is a trademark of Okta, Inc. |

Tiles (never a recolour): Vault sits on a dark slate tile (its yellow triangle is too faint on a light header); Kafka and MySQL (dark marks) sit on a white tile in dark mode only; a user-supplied logo always sits on a white tile. See `web/js/components/comp-icon.js`.

The flow diagram (heads and store bands) draws the object-type icons through `web/js/views/flow-draw-icons.js`, which reads the mapping in `object-icon.js`.

To add one: put the SVG here, add its name to `BUILTIN_ICON_GROUPS` in `core/component-icons.ts`, and (for an object type) map it in `web/js/components/object-icon.js`.
