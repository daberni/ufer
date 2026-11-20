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

drizzle-kit 0.31 still declares the deprecated `@esbuild-kit/esm-loader`, which pulls in a vulnerable esbuild 0.18, although its CLI never loads that package. The `package.json` override aliases it to `tsx`; remove the override once a stable drizzle-kit release no longer declares the dependency (the 1.0 release candidates already drop it).

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

## Transaction provider data changeset

Changeset 0004 adds three nullable columns to `transactions`: `instructed_amount_minor` and `instructed_currency` hold the original amount of a foreign-currency booking in minor units, signed like `amount_minor`, and `provider_payload` holds the provider's transaction object as JSON text. Further provider fields such as dates, bank transaction and merchant category codes or counterparty identifiers stay in `provider_payload`; a feature that needs one as a column adds it with a new changeset that backfills from that JSON. Existing rows, CSV imports and manual entries keep `NULL`; no existing value, index or constraint changes. Bank-synced rows receive the data on their next sync, which also refreshes it for rows with manual categories; transactions the bank no longer returns keep `NULL`. The upgraded database requires this application version; roll back by restoring the pre-upgrade backup with the previous application or fix forward with a new changeset. It has been applied only to disposable test databases.

## Transaction types changeset

Changeset 0005 gives every transaction an explicit type and replaces the category flag `is_transfer`. Adding a `NOT NULL` column with a default and then backfilling would work. This changeset instead rebuilds `transactions` to require an explicit transaction type without a permanent database default with the same columns, constraints and indexes plus `type` (`income`, `expense`, `transfer`, `opening_balance`, `adjustment`), `type_source` and `transfer_source` (`auto` or `manual`) and the nullable `transfer_id` shared by the two linked bookings of a transfer. A unique partial index `transactions_transfer_side` allows one outgoing and one incoming booking per transfer, and a check constraint allows `transfer_id` only on transfers. No other table references `transactions`. Existing rows keep every value: a transaction in a category flagged `is_transfer` becomes a transfer (manual when its category was assigned manually), every other one income when its amount is positive and an expense otherwise, so income, expenses, breakdowns and trends are unchanged. No transfers are linked by the changeset; the next sync, CSV import or demo seed pairs them by the automatic rule. Finally `categories.is_transfer` is dropped; the seeded Transfer category stays as an ordinary category. The upgraded database requires this application version; roll back by restoring the pre-upgrade backup with the previous application or fix forward with a new changeset. It has been applied to disposable databases only: a demo seed created with the previous application, migrated and compared, kept identical row counts, amounts, original columns and cash-flow results for every month. Applying it to a hosted database needs separate approval.


## Retiring the seeded transfer category

`0006_retire_transfer_category.sql` retires the seeded category with ID `transfer` only while its name (`Transfer`), color (`#8c9692`) and empty icon are untouched, no booking was assigned to it manually, and no user-created or edited rule targets it. The exact original definitions of the demo-owned rules `demo-rule-own-transfers` and `demo-rule-joint-account` are the only rule references eligible for removal; editing either rule preserves the category and every dependent rule and assignment. Any detected customization keeps the seeded category as an ordinary category, regardless of its ID. When retirement is eligible, automatic category assignments become uncategorized; amounts, transaction types, provider identities and transfer links stay unchanged. Categories with other IDs remain unchanged. Historical edits that restored every original value cannot be distinguished from an untouched seed because these records have no modification provenance. The preceding transaction-type migration must run first. This changeset is prepared in the PR only; do not apply it to an existing hosted database without a backup and separate approval.

## Manual account transactions changeset

Changeset 0007 changes data only; no table, column or index changes. For every manual account (`provider='manual'`) it turns the balance history into transactions: the first snapshot becomes an `opening_balance` and each later snapshot an `adjustment`, dated as the snapshot, with reference `manual:<id>`, no category and a manual type. Each row books the snapshot's difference to the previous one minus the transactions already on the account in between, so the balance at the end of every snapshot date equals that snapshot; a later snapshot without a difference books nothing. Where the sum then differs from the stored current balance (transactions after the newest snapshot, or a balance without history), one more row books the difference on the newest date; an account with a stored balance and no transactions gets it as its opening balance. Finally the manual accounts' snapshots are deleted and their `balance_minor`/`balance_date` set to `NULL`, because their balance is now the sum of their transactions. Synced accounts, their snapshots and every existing transaction are unchanged, and income, expenses, breakdowns and trends stay identical because only income and expenses count. A manual account without a stored balance and without history stays without a balance. The upgraded database requires this application version; roll back by restoring the pre-upgrade backup with the previous application or fix forward with a new changeset. It has been applied to disposable databases only: the migration test compares every balance, the balance at every snapshot date, the original transactions and cash-flow results before and after it, and a demo seed created with the previous application kept identical balances and cash-flow reports. Applying it to a hosted database needs separate approval.


## Bank balance classification changeset

Changeset 0008 adds the nullable `balance_snapshots.bank_balance_type` text column. It retains the provider's selected balance code, such as `CLBD` (closing booked), `ITBD` (interim booked) or `CLAV` (closing available). Existing observations remain `NULL`: no classification is inferred or backfilled, and no amount, date, account, booking or source is changed. New bank syncs record the selected code and refresh it together with the balance when the same date is synced again. Calculated history points carry no bank classification; they remain estimates even when anchored to a closing booked observation.

The migration was tested on disposable synthetic databases and has been applied and verified on the shared Preview database. Production was migrated on 2026-11-19 after a verified backup and a rehearsal on its copy. Preview deployments run only for pull requests labelled `preview`. The upgraded database requires this application version; recover by restoring the pre-upgrade backup together with the previous application, or fix forward with a new changeset. Applied changesets 0000–0007 remain unchanged.


## Provider account names changeset

Changeset 0009 adds nullable `accounts.provider_name`, retaining the bank-supplied account label separately from the user's editable display name. Existing names and every provider identifier, account balance, transaction and observation remain unchanged. Existing provider names stay unknown (`NULL`) until an authorization/reconnect supplies a name or product; the migration does not pretend an existing custom name came from the bank. New bank accounts initialize their display name from the provider label, while later reconnects update only the separate provider label. Ordinary balance/transaction syncs never replace either label.

It was tested on disposable synthetic databases and, together with changeset 0008, has been applied and verified on the shared Preview database. Production receives it with this release, after a verified backup and a rehearsal on its copy (2026-11-19). Recover by restoring the pre-upgrade database and application together, or fix forward; earlier applications reject the new recorded migration. Existing-database upgrades require separate approval and a backup.

## Transaction overrides and hidden bookings changeset

Changeset 0010 adds three nullable text columns to `transactions`: `counterparty_override` and `description_override` hold a person's payee and description for an imported or synced booking, and `suppressed_at` records when such a booking was hidden. The source's own `counterparty` and `description` stay in place and keep being refreshed by syncs and imports; lists and search show the override when one exists. A hidden booking stays stored, so the next sync or import updates it instead of adding it again, and it no longer counts toward manual account balances, cash flow, spending, balance history or transfer pairing. Rule categorization still matches the source's text (as of 2026-11-20, rules also match the overridden text; see the [feature comparison](feature-comparison.md)). Existing rows keep every value and receive `NULL` in the new columns, so nothing is overridden or hidden and every balance and report is unchanged. No index, constraint or other table changes. The upgraded database requires this application version; roll back by restoring the pre-upgrade backup with the previous application or fix forward with a new changeset. It has been applied to disposable test databases only; applying it to the Preview or Production database needs separate approval and a backup.

## Category rule attribution changeset

Changeset 0011 adds the nullable text column `transactions.category_rule_id`, the rule that assigned a rule-sourced category. Syncs, imports, manual entries, applying rules and a new rule's optional application record the deciding rule; a manual assignment clears it. Deleting a rule clears its references in the same write transaction and keeps the categories; deleting a category without a replacement deletes its rules and clears their references. The column is deliberately not a foreign key, so a sync or import that read a rule deleted meanwhile still saves, and the application treats an unknown rule ID as unrecorded. Existing rows receive `NULL`, so every earlier rule assignment stays unattributed until rules are applied again, which records the deciding rule without reporting an unchanged category as updated. No category, balance or report changes; no index or constraint changes. Roll back by restoring the pre-upgrade backup with the previous application or fix forward. It has been applied to disposable test databases only; applying it to the Preview or Production database needs separate approval and a backup.

## Account archiving changeset

Changeset 0012 adds the nullable `accounts.archived_at` text column, an ISO timestamp set while an account is archived. Every existing account keeps `NULL` and stays visible; no other column, row, transaction or observation changes. Archiving and restoring only set or clear this column, and removing a bank connection can set it for the detached accounts. The upgraded database requires this application version; earlier applications reject the unknown recorded changeset. Recover by restoring the pre-upgrade backup together with the previous application, or fix forward with a new changeset. It has been applied to disposable synthetic databases only; applying it to the shared Preview or Production database needs a backup and separate approval.
