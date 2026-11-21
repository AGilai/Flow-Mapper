# Icons

All files are the vendors' own marks, unmodified downloads except `auth0.svg` (see below). Vendor logos are trademarks of their owners and are shown only to identify the product.
Component types (0.68.0, frame 34, `type`, the catalogue in `core/component-types.ts` and its browser mirror `web/js/components/type-info.js`) and the product icons by object type (`web/js/components/object-icon.js`) use the same files. The legacy `details.icon` names of 0.65 - 0.67 map to the same files (`vault` is the type `hashicorp-vault`).

| Files | Source | Terms |
|---|---|---|
| `aws-*.svg` (service icons: lambda, ec2, ecs, eks, sqs, sns, eventbridge, step-functions, dynamodb, rds, elasticache, s3, api-gateway, cloudfront, kinesis, cognito, kms, secrets-manager, iam; plus `aws-event.svg` for event types) | Official AWS Architecture Icons, Icon-package_07312026, `Architecture-Service-Icons/Arch_<Category>/48/Arch_<Service>_48.svg`. https://aws.amazon.com/architecture/icons/ | Provided by AWS for depicting AWS services in architecture diagrams; use per the terms on that page (no modification, no implied endorsement). |
| `vault.svg` | Devicon v2.16.0 `icons/vault/vault-original.svg`, https://github.com/devicons/devicon | Devicon is MIT; the Vault logo is a HashiCorp trademark. |
| `kafka.svg` | Devicon v2.16.0 `icons/apachekafka/apachekafka-original.svg` | MIT; Apache Kafka is a trademark of the Apache Software Foundation. |
| `mongodb.svg`, `redis.svg`, `postgres.svg`, `rabbitmq.svg` | Devicon 2.16.0 `*-original.svg` | MIT; trademarks of their owners. |
| `mysql.svg`, `elasticsearch.svg` | Devicon v2.16.0 `icons/mysql/mysql-original.svg`, `icons/elasticsearch/elasticsearch-original.svg` (the official marks; since 0.65 these replace the hand-drawn stand-ins of 0.27.3) | MIT; trademarks of their owners. |
| `auth0.svg` | simple-icons 11.14.0 `icons/auth0.svg`, https://github.com/simple-icons/simple-icons (Devicon has no Auth0 icon). The source is a single colourless path; the only change is `fill="#EB5424"` (Auth0's brand orange) on that path, so it ships as a coloured SVG like the others. | CC0 1.0 for the file; Auth0 is a trademark of Okta, Inc. |
| `generic/Res_<Name>_48_Light.svg` and `generic/Res_<Name>_48_Dark.svg` for Name = Generic-Application, Authenticated-User, Credentials, Database, Data-Table, Data-Stream, Forums, Folder, Magnifying-Glass, Source-Code, Servers, Internet, Globe, Gear (28 files, the generic types) | Official AWS Architecture Icons, Icon-package_07312026, `Resource-Icons_07312026/Res_General-Icons/Res_48_Light/Res_<Name>_48_Light.svg` and `.../Res_48_Dark/Res_<Name>_48_Dark.svg`. https://aws.amazon.com/architecture/icons/ . The Light file is the dark-ink glyph (#232F3D) for light backgrounds, the Dark file the white glyph for dark backgrounds; the UI swaps them with the theme (`web/js/components/comp-icon.js`). Unmodified. | Provided by AWS for depicting AWS services in architecture diagrams; no modification, no implied endorsement. |
| `kubernetes.svg` | Devicon v2.16.0 `icons/kubernetes/kubernetes-plain.svg` (the v2.16.0 tag) | MIT; Kubernetes is a trademark of The Linux Foundation. |

Generic type to file: service = Generic-Application, idp = Authenticated-User, vault = Credentials, database = Database, cache = Data-Table, queue = Data-Stream, topic = Forums, storage = Folder, search = Magnifying-Glass, function = Source-Code, container = Servers, gateway = Internet, cdn = Globe, workflow = Gear. The AWS package has no dedicated icon for cache, topic, function, container, gateway, cdn or workflow: those use the closest general icon.

Tiles (never a recolour): Vault sits on a dark slate tile (its yellow triangle is too faint on a light header); Kafka and MySQL (dark marks) sit on a white tile in dark mode only; a generic icon has no tile. See `web/js/components/comp-icon.js`.

The flow diagram (heads and store bands) draws the object-type icons through `web/js/views/flow-draw-icons.js`, which reads the mapping in `object-icon.js`.

To add one: put the SVG here, add the type to `core/component-types.ts` and to its mirror `web/js/components/type-info.js` (a test keeps them equal), and (for an object type) map it in `web/js/components/object-icon.js`.
