# Product and architecture direction

Updated: 2026-11-15. Ufer is the current working product name. This document records requirements and design direction; proposed capabilities are not presented as implemented.

## Why build when alternatives already synchronize banks?

Bank sync is not a differentiator by itself. [Actual Budget already supports multiple bank providers](https://actualbudget.org/docs/advanced/bank-sync/), and [Firefly III supports Enable Banking through its Data Importer](https://github.com/firefly-iii/docs/blob/main/docs/docs/tutorials/data-importer/eb.md). Both should be evaluated before assuming a new application is necessary.

The proposed reason to continue Ufer is a focused combination of a responsive wealth overview, transaction management with clear provenance, flexible imports, security-level investment tracking, and a simple self-hosted or managed deployment. These are product goals, not claims of unique features or superiority. Their value must be demonstrated against existing products. A good-looking dashboard and a working sandbox flow alone do not establish that value.

## Database providers

**Implemented:** SQLite locally and remote libSQL through `@libsql/client`. This already covers a zero-configuration NAS installation and persistent external storage for Vercel. It is one SQL family, not generic PostgreSQL support.

**Target:** support SQLite/libSQL and PostgreSQL as explicit adapters behind shared domain-facing repositories. A universal SQL string wrapper is insufficient: placeholders, dates, conflict handling, booleans, transactions, migrations, and concurrency differ across engines.

| Concern | Direction |
| --- | --- |
| Application boundary | Domain repositories for accounts, transactions, imports, portfolios, and sync coordination; business rules do not depend on a driver |
| Provider selection | Validated server configuration selects SQLite/libSQL or PostgreSQL; reject unsupported combinations clearly |
| Schema lifecycle | Versioned migrations per engine, backup instructions, and upgrade tests; no destructive automatic migration of existing user data |
| Financial correctness | Exact amounts and quantities, idempotent imports, atomic splits, and manual override preservation must behave the same on both engines |
| Validation | Run consequential repository behavior tests against both providers before marking PostgreSQL supported |

PostgreSQL is a reasonable target for managed hosting, but a database switch alone does not create a SaaS product. Tenant isolation and authorization must exist at every data access boundary. Current sandbox/production isolation separates provider environments; it is not tenant isolation. No new database engine or schema migration is introduced by this documentation change.

## Free self-hosting and paid managed hosting

The intended business model is a freely self-hostable application plus a paid managed service. Payment would cover hosting, scheduled jobs, updates, backups, monitoring, and support. No prices or paid feature restrictions are decided.

Open-source software and charging for services are compatible; the [GNU guidance on selling free software](https://www.gnu.org/philosophy/selling.en.html) explicitly permits commercial distribution and support. The actual project license remains undecided. An open-source license must not be described as automatically preventing other providers from offering paid hosting.

Enable Banking's [restricted production mode](https://enablebanking.com/docs/api/linked-accounts/) covers evaluation and individual non-commercial access to linked own accounts. Managed multi-customer access requires checking commercial terms and obtaining the appropriate agreement. Provider costs and eligibility must be established before promising a hosted bank-sync plan.

Before SaaS operation, add tenant isolation, user accounts and authorization, operational secret management, durable jobs, restore-tested backups, monitoring, billing, and a data retention/deletion policy. The current single-password workspace is not suitable for multiple independent customers.

## Required unattended synchronization

Sync must run while all browsers are closed on every supported hosting platform. Docker has a scheduler profile and Vercel has a protected cron route today. A deployment must include and verify its scheduler; it cannot be advertised as supported with only a manual refresh button.

Keep scheduling separate from the banking provider. Use concurrency control, idempotent imports, persisted outcomes, visible failures and consent expiry, and recovery after restarts. Serverless installations may need durable workers when provider calls exceed request limits. Do not assume identical consent durations across institutions.

## Transaction editing and provenance

Only category editing exists today because the initial MVP implemented that operation first. Imported data is not inherently uneditable.

| Requirement | Intended behavior |
| --- | --- |
| Provenance | Link every imported transaction to provider/institution, source account, stable external reference, import or sync run, and retrieval time. CSV imports retain their import profile/batch and source filename metadata without publishing uploaded files. |
| Original source | Retain the normalized original values and enough source identity for traceability. Decide raw payload retention and privacy limits explicitly. |
| User corrections | Store explicit overrides separately from source values; show which fields were changed. Subsequent sync updates source data without silently replacing manual corrections. |
| Manual transactions | Support creating, editing, and deleting entries. Define reconciliation with subsequent imports rather than relying only on display text. |
| Deleted imported entries | Preserve a suppression/tombstone rule so a later sync does not silently recreate a deliberately deleted entry. |

The current schema has account/provider links and prefixed provider references. It does not yet link each transaction to a specific import run, preserve complete original-versus-override values, or expose a complete source trail in the UI. Schema changes require explicit migrations.

Split transactions are required: allocate an original booking across categories without changing its economic total. Children must sum exactly to the parent amount in the original currency. Reports must count the amount once, manual allocations must survive resync, and refunds/transfers need defined behavior.

## Import configuration

Build a general CSV import workflow with a preview, selectable delimiter/encoding/date/amount conventions, account and field mapping, stable ID selection, reusable profiles, validation, and a visible import result. Detect collisions within a file and define how overlapping bank/CSV imports reconcile.

A dedicated Buxfer parser or migration assistant is not a priority. Historical exports should use the general configurable CSV workflow. PDF support remains a separate future decision, not a prerequisite.

## Securities and valuations

Security-level tracking is required beyond recording a single investment account balance. Proposed domain objects are securities, trading venues, holdings, security transactions, price observations, and portfolio valuations.

| Area | Requirement |
| --- | --- |
| Identification | Store ISIN and instrument name; preserve trading venue/MIC, local symbol, and quote currency where applicable. ISIN alone does not uniquely identify the venue or quotation. |
| Holdings | Exact quantities and trade events, fees and currencies; separate settlement cash from securities to avoid double counting |
| Prices | Manual price entry initially; later quote-provider adapters with timestamps, venue/currency, source, freshness and licensing information |
| Valuation | Market value derived from holdings and an explicit price observation; optional FX conversion must be visible and reproducible |
| History | Portfolio and total-net-worth timelines based on dated valuations; do not silently substitute current prices into historical observations |

No market-data provider is selected. Price availability, venue coverage, redistribution rights, and commercial SaaS use need validation. Published competitor portfolio features are not evidence that every broker or instrument works reliably. Performance and tax reporting require additional decisions about cost basis, cash flows, and corporate actions.

## Repository privacy and language

Maintain documentation, code comments, UI copy, API messages, and synthetic examples in English. Preserve existing user-entered data; translating source defaults is not permission to rewrite a user's stored categories or transactions.

Repository content must describe a generic product. Do not include personal institution lists, account inventories, real balances, IBANs, application identifiers, local user paths, private keys, financial exports, or screenshots of real data. Generic financial concepts and supported data types belong to the application model and are not a statement about its owner's finances.

## Decisions still open

Project license, commercial banking agreement, market-data provider, SaaS pricing, and detailed PostgreSQL adapter implementation are not settled. The accepted functional priorities are tracked in the [feature comparison](feature-comparison.md#tracked-work).
