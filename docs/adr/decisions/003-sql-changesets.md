---
title: "Manage database upgrades with versioned SQL changesets"
adr:
  id: "003"
  status: accepted
  date: 2026-11-15
  authors:
    - Ufer maintainers
---

# Manage database upgrades with versioned SQL changesets

## Context

The old connection helper ran CREATE TABLE IF NOT EXISTS and seed statements at startup without an applied-version history. That cannot safely express future data-model evolution.

## Decision

Use Drizzle Kit custom SQL changesets and the Drizzle libSQL migrator. Verify migration history/checksums and the known legacy baseline. Preserve fresh-install setup, but require an explicit maintenance command for existing-database adoption and future upgrades. Do not migrate an existing user database as part of this refactor.

Use a shared Drizzle TypeScript schema for typed persistence and inferred models. The initialized ORM instance wraps the existing libSQL client; raw SQL uses its `$client`, not another application connection. SQL changesets remain the authoritative upgrade history. Update the runtime schema alongside future changesets; this is not a switch to automatic schema synchronization or generated migration diffs.

## Consequences

SQL stays reviewable and driver-specific. The database connection no longer owns inline DDL. Operators must serialize migrations and keep restorable backups. PostgreSQL remains a future adapter, and tenant backfill requires separate reviewed changesets and authorization.

## Compliance

Test empty initialization, unchanged legacy startup, idempotent explicit adoption, preservation of manual financial corrections, and rejection of unknown schemas or modified history. Include changesets in production artifacts.

## Notes

[Migration workflow](../../database-migrations.md), [Drizzle migration documentation](https://orm.drizzle.team/docs/migrations).
