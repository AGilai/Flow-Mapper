# Vendored browser files

Only files the browser loads as-is, kept in the repo so the app runs with no install and no network. Each is pinned; nothing here is in package.json.

## mermaid/mermaid.min.js

- Mermaid 11.4.1 (published 2024-11-27), MIT licence (`mermaid/LICENSE`).
- Source: https://registry.npmjs.org/mermaid/-/mermaid-11.4.1.tgz (tarball sha256 `ec7b61b391aaa24bf666fd20e48d0a626eeb4a95b95bc6b3016a122d7f0bc2af`), file `package/dist/mermaid.min.js`, copied unchanged.
- sha256 of the file: `a43bc1afd446f9c4cc66ac5dd45d02e8d65e26fc5344ec0ef787f88d6ddb6f9e`
- Used by `web/js/notes/diagram.js`, loaded lazily with a `<script>` tag only when a note holds a Mermaid block.
- Update: download the new tarball into an empty directory, copy only `dist/mermaid.min.js` and `LICENSE`, update this file.
