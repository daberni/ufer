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

## Code and architecture conventions

- Develop against the current application state. Internal APIs, component props and module structure may change together; update all callers in the same change instead of retaining old signatures, aliases, compatibility facades or fallback branches for hypothetical earlier versions. Add compatibility only for an explicitly supported external contract.
- Persisted data is the compatibility boundary: evolve schemas and stored formats through explicit, versioned migrations that preserve existing data. Migration requirements do not justify keeping obsolete application code or supporting mixed application versions by default.
- Follow [docs/code-style.md](docs/code-style.md): braces, one statement per line, meaningful whitespace, explicit objects and responsibility boundaries. Run lint, type checks, behavior tests, stylesheet checks and the production build for relevant changes.
- Keep Next.js API route handlers thin and follow idiomatic Next.js filesystem routing. Organize business logic by feature; do not enforce one file per operation or consolidate routes solely to reduce file count. The current catch-all route is only a JSON-404 fallback.
- API errors use RFC 9457 Problem Details with a trace ID; see [HTTP errors](docs/http-errors.md). Use the shared ValidationError for user-correctable domain input and keep unexpected exceptions private. Update clients with the current contract instead of retaining obsolete response fields.
- HttpError may also express explicit API outcomes in services, repositories and infrastructure; a separate transport-independent exception hierarchy is not required. Keep user-input validation (422) distinct from rejected provider data (502), and translate shared validation at the provider boundary.
- Use the shared Drizzle schema and inferred models for typed persistence. Reuse the initialized Drizzle instance and its underlying libSQL client; do not create a second application connection for raw SQL. Keep schema definitions and reviewed SQL changesets aligned.
- Services coordinate validation and use cases; repositories own database reads/writes and transaction boundaries. Keep provider normalization and categorization separate from persistence. Do not generate SQL statement arrays in general utilities or execute database queries from services. Raw SQL belongs in a focused repository/read projection or migration infrastructure when it serves a concrete purpose.
- Keep business features together under `src/features/<feature>/`, with server-only services/repositories in that feature's `server/` directory. Reserve `src/server/` for shared database, HTTP, job and security infrastructure. Browser modules must never import a feature's `server/` modules.
- Use maintained libraries for security protocols: Better Auth owns individual credentials, browser sessions and authentication rate limits and jose owns provider JWT signing. Do not implement custom session seals, expiry handling or JWT serialization. Persisted bank-secret formats may only change through an explicit data migration.
- The canonical application icon is a real SVG made of vector paths; derive required raster platform exports from it instead of embedding raster images inside SVG.
- Use feature components and focused hooks with colocated CSS Modules for styles they own. Import shared primitive styles directly when no local override is needed; use composition for actual local variants. Keep account/transaction styles in their features and avoid empty modifiers or forwarding-only stylesheets. Use clsx directly for conditional classes.
- Use checked-in SQL changesets and the documented [migration workflow](docs/database-migrations.md). Never edit applied changesets or automatically upgrade an existing database at web startup. Existing-schema/data migrations need explicit authorization.
- [Architecture](docs/architecture.md) and [YAML-frontmatter decisions](docs/adr/README.md) distinguish implemented behavior from proposed workspace/identity/SSO models. The application remains single-workspace until scoped authentication, persistence, jobs and cross-workspace checks are implemented.

## Git workflow

- Squash-merge pull requests by default. Use another merge method only when explicitly requested.
- Direct commits, including commits on main, may be used for small, cohesive change packages when explicitly approved. A request to implement a feature does not automatically authorize a commit.
- Before each commit, present its concrete scope and include only the approved package. Approval for one package does not authorize subsequent commits or unrelated changes.
- Commit creation and remote publication require separate authorization unless the user explicitly approves both for that package. Never infer continuing commit or push permission from earlier work.
