# Banking and imports

This guide describes the current bank integration, financial data behavior and supported import formats. For installation and deployment, see [setup and operation](setup.md). For planned capabilities, see the [feature comparison](feature-comparison.md).

## Bank synchronization

The current provider is [Enable Banking](https://enablebanking.com/docs/api/reference/). Ufer uses account information endpoints only: application JWTs, institution discovery, authorization, sessions, balances, and paginated transactions. It does not initiate payments.

Sandbox and production data are isolated. Sandbox institutions do not establish production bank coverage. Live access requires a production application and the provider's account-linking or commercial onboarding process. [Restricted own-account access](https://enablebanking.com/docs/api/linked-accounts/) is intended for evaluation and individual non-commercial use; it is not a contract for a hosted SaaS product.

Authorizations expire according to the institution's consent duration. The UI warns seven days before expiry and supports reconnecting. Stable identification hashes match reconnects to existing accounts; a changed account currency prevents automatic remapping.

Bank connections can be removed from the Bank connections view after a confirmation that lists the effects. Removal keeps the linked accounts with their balances, balance snapshots, transactions and categories; it detaches them from the connection, so manual and scheduled syncs skip them and their balances stay at the last synced value. The encrypted session ID is deleted locally and the removed connection no longer appears in the list. Ufer then asks Enable Banking to delete the session (`DELETE /sessions/{session_id}`), which closes the bank consent where the bank supports it. Local removal does not depend on that call: if it fails, the result says so and the consent ends at its expiry or when withdrawn at the bank. Removal is refused while a sync runs or while a callback is still exchanging its authorization code; a callback links its connection only in the same transaction that maps its accounts, so a connection removed meanwhile is never linked. Connecting the same bank again later maps the kept accounts through their identification hashes instead of creating duplicates. Removed accounts are not converted to manual accounts and cannot be deleted yet.

Sync retrieves a rolling 89-day window, processes accounts sequentially, follows all continuation pages, and persists only booked (`BOOK`) transactions. Deduplication uses `entry_reference` per account; `transaction_id` is not reliably unique. Missing or conflicting references stop that account's import. Manual category corrections, including deliberately uncategorized transactions, survive repeat imports. Provider references and account links exist today. Each sync run in the history links to the transactions it inserted (see [architecture](architecture.md)); runs recorded before this link show their count without a list. CSV import batches, a complete provenance trail and editable transaction overrides are planned.

Application keys stay on the server. Bank session IDs are encrypted with AES-256-GCM. Authorization callbacks bind the initiating user, exact live authentication session, active installation-workspace membership and browser secret, expire after 15 minutes, and are single-use. Back up the database and encryption key together. Financial database contents are not end-to-end encrypted.

## Data and imports

Amounts use integer minor units. Different currencies are never silently converted or summed. The dashboard separates latest known asset balances from month-filtered cash flow. Every transaction has a type (income, expense, transfer; opening balance and adjustment for manual accounts) independent of its category, and only income and expenses count toward cash flow, spending and trends. A synced booking whose counterparty IBAN belongs to another synced account becomes a transfer; otherwise new bookings start as income or expense by direction. Rules assign categories to transfers like to any other booking, and a transfer no rule matches stays uncategorized. After each sync and CSV import, a transfer and an unlinked booking with the opposite amount in the same currency on another own account at most three days apart are linked as one transfer when each has exactly one such candidate. Manual type changes, links and unlinks survive resync and imports. A person links only bookings with the exact opposite amount in the same currency at most 14 days apart; transfers with a fee or a currency exchange stay transfers without a counterpart. A transfer someone saved without a counterpart is never paired automatically afterwards. See [ADR 008](adr/decisions/008-transaction-types-and-transfers.md).

The schema includes accounts, transactions, categories, categorization rules, bank connections (`requisitions`), account identifiers, balance snapshots, sync history, leases, and login throttling. Drizzle provides typed table models, a shared database connection and versioned SQL changesets. Empty databases receive the initial schema; a recognized existing database opens without automatic schema/history changes. Existing-database adoption and future upgrades require explicit maintenance; see the [migration workflow](database-migrations.md). Individual users and active membership of one constrained installation workspace are implemented in source; independent-customer isolation and SSO remain unimplemented. See [user management](user-management.md) for the required rollout.

Manual valuations and CSV imports are available. Current imports require a fixed UTF-8 format with comma or semicolon delimiters and an optional BOM. Configurable field mapping, previews, and reusable import profiles are planned. There is no PDF importer or dedicated migration wizard for another product.

Balance snapshots record an account's balance or asset valuation on a given date, together with its source (bank sync, manual entry or CSV). They preserve history when the latest balance changes. This is necessary for investments whose market value cannot be reconstructed from cash transactions alone. Historical net-worth charts are planned; snapshots are already persisted, but no history chart is available yet.

Balance-history CSV:

```csv
date;balance;currency
2026-01-15;1000.00;EUR
```

The latest dated snapshot updates the current balance; older imports cannot overwrite a newer current balance. A repeated date updates that snapshot.

Booked transactions:

```csv
id;date;amount;currency;counterparty;description
example-001;2026-01-15;-12.50;EUR;Example merchant;Example purchase
```

IDs must be stable and unique per account. Reimporting updates rather than duplicates. Transaction imports do not recalculate the account balance. Limits: 1 MB, 10,000 rows, ISO dates, and the account's currency. Use a decimal point, or a decimal comma with semicolon delimiters, without thousands separators.

Rules match payee and description case-insensitively. Lower priority numbers win; among rules with the same priority, the older rule wins. Rules have no creation timestamp, so age comes from SQLite's `rowid`, which `VACUUM` or a table-rebuild migration can renumber; such maintenance may reorder rules of equal priority, so give overlapping rules different priorities when the order matters. Applying rules preserves manual assignments. A rule created from a category assignment can also categorize the uncategorized transactions it decides; if another rule is created at the same moment, that choice may miss the other rule until rules are applied or the next sync. Regular expressions use RE2 syntax without backreferences or lookbehind.
