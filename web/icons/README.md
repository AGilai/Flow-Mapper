# Icons

| Files | Source | Terms |
|---|---|---|
| `aws-*.svg` | Official AWS Architecture Icons, package of 2026-07-31 (https://aws.amazon.com/architecture/icons/) | Provided by AWS for depicting AWS services; see the terms on that page. Unmodified. |
| `redis.svg`, `mongodb.svg`, `postgres.svg`, `rabbitmq.svg` | Devicon 2.16.0 (https://github.com/devicons/devicon), `*-original.svg` | MIT. The logos are trademarks of their owners. |
| `mysql.svg`, `elasticsearch.svg` | Drawn by hand for Flow-Mapper (0.27.3): no offline source for the official logos. A simplified mark in each product's brand colours (MySQL: a cylinder in blue and orange, not the dolphin; Elasticsearch: a disc cut in the Elastic yellow, pink, teal and blue). | Original artwork, MIT with the project. Replace with the official logos when they can be fetched. |

The flow diagram (heads and store bands) draws these through `web/js/views/flow-draw-icons.js`, which reads the mapping in `object-icon.js`.

To add one: put the SVG here and map it in `web/js/components/object-icon.js`.
