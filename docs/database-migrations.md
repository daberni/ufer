# Database changesets and safe upgrades

Ufer uses Drizzle ORM for typed persistence and Drizzle's libSQL migrator and Kit for checked-in SQL changesets. The TypeScript schema describes the current runtime model; reviewed SQL changesets are authoritative for database creation/upgrades. This remains a SQL-first migration workflow, not automatic synchronization from TypeScript. PostgreSQL needs a separate adapter and dialect-specific changesets before it is supported.

## Files and commands

| Item | Purpose |
| --- | --- |
| `drizzle/sqlite/*.sql` | Ordered, reviewable changesets; never edit an applied file |
| `drizzle/sqlite/meta/_journal.json` | Tool-generated sequence and version timestamps |
| `src/server/database/migrations.ts` | History/checksum verification, legacy-baseline validation and initialization policy |
| `src/server/database/schema.ts` / `models.ts` | Shared table definitions and inferred select/insert types |
| `src/server/database/connection.ts` | One initialized Drizzle instance with its underlying libSQL client exposed as `$client` |
| `npm run db:generate -- --name=describe_change` | Generate an empty custom SQL changeset; fill in and review the SQL |
| `npm run db:status` / `npm run db:migrate` | Inspect state / explicitly apply pending changesets using the configured database |

The CLI loads environment configuration using Next's environment loader. Existing `DATABASE_URL` environment values take precedence. Default database path and Docker volume names are preserved. Do not place credentials or user-specific paths in migration files.

`drizzle.config.ts` points at the shared runtime schema. The configured generator still uses `--custom`; fill in each SQL changeset and update the TypeScript schema in the same change. The original custom-migration snapshot does not represent the table model, so do not drop `--custom` and assume generated diffs are based on the existing database. Switching to schema-generated diffs requires a separately verified snapshot baseline, without rewriting any applied SQL or migration history. Do not use `drizzle-kit push` or automatic destructive schema synchronization.

Typed account/category/rule/connection operations, bank/CSV writes, leases and library-managed authentication persistence share one application connection. Repositories own these queries and transaction boundaries; services and general utilities do not execute SQL. The dashboard read projection retains raw SQL through the shared `$client`. The maintenance command creates its own short-lived client through the same factory. ORM types do not replace request validation, financial rules, tenant authorization or migration review. Integer minor-unit amounts and existing SQL defaults/constraints remain in place. The inherited SQLite DDL does not explicitly mark text primary keys `NOT NULL`; Drizzle's primary-key types assume non-null IDs, and application writes must always supply valid IDs. This refactor does not silently tighten that stored constraint.

## Initialization policy

| Database state | Application start | Explicit maintenance command |
| --- | --- | --- |
| Empty database | Applies the current checked-in changesets and seed data, preserving first-install behavior | Can initialize before deployment |
| Recognized pre-migration schema | Opens without schema/history/seed writes only while the initial baseline is current; additional changesets require maintenance | Validates the exact legacy baseline, records migration history and applies reviewed changesets |
| Managed, current | Verifies applied changeset hashes and opens | No-op when already current |
| Managed, pending | Refuses automatic upgrade and explains the required maintenance command | Applies pending SQL after operator review/authorization |
| Unknown legacy shape or changed history | Fails with a reviewable error; does not attempt repair | Also refuses; prepare a specific recovery/migration plan |

The initial changeset preserves the pre-existing application tables and indexes. Legacy adoption adds Drizzle's bookkeeping table and any missing seed categories; it does not rewrite accounts, amounts, source identities, connections or manual corrections. Adoption has not been run against an existing user database in this refactor.

The startup exception is only for an empty first-install database. Run migrations once as a serialized deployment/maintenance step before serving traffic, especially for remote databases or multiple app instances. Do not rely on concurrent cold starts to coordinate schema creation.

## Review and apply

1. Generate and review a new forward-only changeset and update the shared runtime schema. State its exact schema/data effects, expected compatibility and recovery path. A safe SQL file is more important than automatic generation.
2. Obtain explicit authorization for changes to an existing database, make a restorable database/key backup and test on a disposable copy. Use synthetic fixtures in CI; never commit financial data.
3. Stop conflicting writes/workers as required by the specific migration. Run a single maintenance process with the intended database configuration; the web application does not apply existing-database upgrades automatically.
4. Verify migration history, foreign keys, row counts and relevant balances/overrides, then validate the application and resume scheduled work.
5. Recover through the reviewed restore/forward-fix plan. Do not edit migration hashes, erase history, rename the database/volume or run a destructive reset to make a failed upgrade disappear.

For Docker, use the explicit maintenance profile once it has been built:

```sh
docker compose --profile maintenance run --rm migrate
```

That command writes to the configured persistent database and requires the same review/authorization as the local command. Migration tooling is included in the dedicated Docker build stage; normal web startup does not invoke it for an existing database.

Tests cover first creation, foreign-key enforcement, unchanged legacy startup, preservation of financial records/manual corrections, idempotent adoption, refusal of unknown schema changes (including literal differences, triggers and views), refusal of altered history, and refusal to apply pending managed changes at startup. These checks do not replace a restore trial of a real deployment.

## Username/password changeset

Changeset 0001 introduces individual authentication and the constrained installation workspace. Review its exact data effects and activation sequence in [user management](user-management.md#migration-and-rollout). Existing pending bank flows are invalidated and the obsolete installation login counter is dropped. Existing financial records and linked encrypted bank sessions are retained. No existing installation has been migrated by the implementation checks.

## Category icon changeset

Changeset 0002 adds the nullable `categories.icon` column. It stores a stable key from the curated set in [category icons](../src/features/categorization/category-icons.ts), never SVG markup; the application validates keys on create and edit instead of a database constraint, so the set can grow without rebuilding the table. Existing categories, including the seeded defaults, keep `NULL` and render without an icon. No other table or row is changed. The upgraded database requires this application version: an earlier version refuses to start because the recorded history contains an unknown changeset. Roll back by restoring the pre-upgrade backup together with the previous application, which discards changes made after the upgrade, or fix forward with a new changeset. No existing installation has been migrated by the implementation checks.
