# Database changesets and safe upgrades

Ufer uses Drizzle ORM for typed persistence and Drizzle's libSQL migrator and Kit for checked-in SQL changesets. The TypeScript schema describes the current runtime model; reviewed SQL changesets are authoritative for database creation/upgrades. This remains a SQL-first migration workflow, not automatic synchronization from TypeScript. PostgreSQL needs a separate adapter and dialect-specific changesets before it is supported.

## Applied state

Production and the shared preview database are migrated through changeset 0016. Changeset 0001 was applied to production on 2026-11-16 and changesets 0008 and 0009 on 2026-11-19, each after a verified backup.

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

drizzle-kit 0.31 still declares the deprecated `@esbuild-kit/esm-loader`, which pulls in a vulnerable esbuild 0.18, although its CLI never loads that package. The `package.json` override aliases it to `tsx`; remove the override once a stable drizzle-kit release no longer declares the dependency (the 1.0 release candidates already drop it).

Typed account/category/rule/connection operations, bank/CSV writes, leases and library-managed authentication persistence share one application connection. Repositories own these queries and transaction boundaries; services and general utilities do not execute SQL. The dashboard read projection retains raw SQL through the shared `$client`. The maintenance command creates its own short-lived client through the same factory. ORM types do not replace request validation, financial rules, tenant authorization or migration review. Integer minor-unit amounts and existing SQL defaults/constraints remain in place. The inherited SQLite DDL does not explicitly mark text primary keys `NOT NULL`; Drizzle's primary-key types assume non-null IDs, and application writes must always supply valid IDs. The changesets do not tighten that stored constraint.

## Initialization policy

| Database state | Application start | Explicit maintenance command |
| --- | --- | --- |
| Empty database | Applies the current checked-in changesets and seed data, preserving first-install behavior | Can initialize before deployment |
| Recognized pre-migration schema | Opens without schema/history/seed writes only while the initial baseline is current; additional changesets require maintenance | Validates the exact legacy baseline, records migration history and applies reviewed changesets |
| Managed, current | Verifies applied changeset hashes and opens | No-op when already current |
| Managed, pending | Refuses automatic upgrade and explains the required maintenance command | Applies pending SQL after operator review/authorization |
| Unknown legacy shape or changed history | Fails with a reviewable error; does not attempt repair | Also refuses; prepare a specific recovery/migration plan |

The initial changeset preserves the pre-existing application tables and indexes. Legacy adoption adds Drizzle's bookkeeping table and any missing seed categories; it does not rewrite accounts, amounts, source identities, connections or manual corrections.

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

## Changesets

Each changeset's SQL header comments and the linked decisions record its detailed effects and rationale. Every upgrade requires the matching application version; earlier applications reject an unknown recorded changeset. Recover by restoring the pre-upgrade backup together with the previous application, or fix forward with a new changeset.

| Changeset | Effect | Production applied |
| --- | --- | --- |
| [0000](../drizzle/sqlite/0000_initial_schema.sql) | Initial schema; preserves the pre-existing application tables, indexes and seed categories | 2026-11-15 (initialized) |
| [0001](../drizzle/sqlite/0001_username_password_authentication.sql) | Individual users, sessions, rate limits and the singleton workspace; binds bank authorizations to user, session and workspace and drops the old login counter ([user management](user-management.md#migration-and-rollout)) | 2026-11-16 |
| [0002](../drizzle/sqlite/0002_category_icons.sql) | Nullable `categories.icon` key from the curated [category icons](../src/features/categorization/category-icons.ts) | Yes |
| [0003](../drizzle/sqlite/0003_transactions_created_at_index.sql) | Index on `transactions.created_at` for sync-run history | Yes |
| [0004](../drizzle/sqlite/0004_transaction_provider_details.sql) | Original foreign-currency amount and raw provider payload on transactions | Yes |
| [0005](../drizzle/sqlite/0005_transaction_types.sql) | Explicit transaction types and linked transfers replace the category `is_transfer` flag, keeping cash-flow results unchanged ([ADR 008](adr/decisions/008-transaction-types-and-transfers.md)) | Yes |
| [0006](../drizzle/sqlite/0006_retire_transfer_category.sql) | Retires the seeded Transfer category only while it is uncustomized | Yes |
| [0007](../drizzle/sqlite/0007_manual_account_transactions.sql) | Turns manual account balance history into opening-balance and adjustment transactions ([ADR 009](adr/decisions/009-manual-account-balances-from-transactions.md)) | Yes |
| [0008](../drizzle/sqlite/0008_bank_balance_classification.sql) | Records the provider's balance type on bank balance observations; no backfill | 2026-11-19 |
| [0009](../drizzle/sqlite/0009_account_provider_names.sql) | Stores the bank-supplied account name separately from the display name | 2026-11-19 |
| [0010](../drizzle/sqlite/0010_transaction_overrides_suppression.sql) | Payee and description overrides and hidden bookings on transactions | Yes |
| [0011](../drizzle/sqlite/0011_transaction_category_rule.sql) | Records the rule that assigned a category | Yes |
| [0012](../drizzle/sqlite/0012_account_archiving.sql) | Account archiving timestamp | Yes |
| [0013](../drizzle/sqlite/0013_import_templates.sql) | `import_templates` table for saved CSV mapping templates | Yes |
| [0014](../drizzle/sqlite/0014_transaction_splits.sql) | `transaction_splits` table for category parts of a booking | Yes |
| [0015](../drizzle/sqlite/0015_rule_transaction_types.sql) | Rule-set transaction types and transfer accounts, with the deciding rule and detected-transfer flag on transactions | Yes |
| [0016](../drizzle/sqlite/0016_drop_banking_environment.sql) | Drops the per-row banking `environment` column; each database serves one environment | Yes |
| [0017](../drizzle/sqlite/0017_bank_account_balances_from_transactions.sql) | Bank-linked accounts derive their balance from transactions: one opening balance per account books the stored balance minus its visible bookings, a stored balance without a snapshot is kept as one, and `balance_minor`/`balance_date` are cleared; current balances and net worth stay identical ([ADR 010](adr/decisions/010-bank-account-balances-from-transactions.md)) | No |
| [0019](../drizzle/sqlite/0019_drop_account_institution.sql) | Drops `accounts.institution`; bank-linked accounts name their bank through their connection, and every stored institution, including user-entered ones on manual accounts and the `CSV import` text, is deleted | No |
