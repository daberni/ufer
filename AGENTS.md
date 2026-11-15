<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Project conventions

- Maintain documentation, code, comments, UI copy, and synthetic examples in English.
- Keep personal account inventories, real financial data, credentials, application IDs, and host-specific paths out of repository content and history.
- Update the feature comparison when capabilities or their verification status change. Keep implemented behavior distinct from planned requirements.
- Preserve existing data, database paths, volume names, and persistence identifiers during branding and copy changes. Schema upgrades require explicit migrations and authorization.
- The current database driver supports SQLite/libSQL. Do not claim PostgreSQL or multi-tenant SaaS support without implementing and verifying it.
