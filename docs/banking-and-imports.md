# Banking and imports

This guide describes the current bank integration, financial data behavior and supported import formats. For installation and deployment, see [setup and operation](setup.md). For planned capabilities, see the [feature comparison](feature-comparison.md).

## Bank synchronization

The current provider is [Enable Banking](https://enablebanking.com/docs/api/reference/). Ufer uses account information endpoints only: application JWTs, institution discovery, authorization, sessions, balances, and paginated transactions. It does not initiate payments.

Sandbox and production data are isolated. Sandbox institutions do not establish production bank coverage. Live access requires a production application and the provider's account-linking or commercial onboarding process. [Restricted own-account access](https://enablebanking.com/docs/api/linked-accounts/) is intended for evaluation and individual non-commercial use; it is not a contract for a hosted SaaS product.

Authorizations expire according to the institution's consent duration. The UI warns seven days before expiry and supports reconnecting. An expired connection keeps its row, accounts and reconnect prompt; if the provider reports its session as ended during a sync, the stored session ID is deleted. Passing the local consent expiry does not start a provider revocation: the expired row retains its encrypted session ID until explicit removal or a confirmed terminal provider response. Stable identification hashes match reconnects to existing accounts; a changed account currency prevents automatic remapping. A reconnect that takes over all accounts of an earlier connection marks it superseded. Its initiating callback makes one attempt to revoke each newly superseded session, and also one attempt for its new session if account mapping fails. A failed attempt does not undo the new linked connection: the released connection remains visible with its credential and an error asking the user to remove it. Unrelated callbacks and scheduled syncs never retry that revocation. A callback that returns with an error, for example after the user cancelled at the bank, consumes its pending state, so the callback URL cannot be used afterwards.

Bank connections can be removed from the Bank connections view after a confirmation that lists the effects. Ufer first asks Enable Banking to delete the session (`DELETE /sessions/{session_id}`), which closes the bank consent where the bank supports it. Only a confirmed revocation or a known terminal response (`EXPIRED_SESSION`, `CLOSED_SESSION`, `REVOKED_SESSION` or `SESSION_DOES_NOT_EXIST`) completes removal: the credential is deleted and the accounts detached in the same transaction. The linked accounts keep their balances, balance snapshots, transactions and categories; syncs then skip them and balances stay at the last synced value. If the provider call fails, the API returns a safe 502 Problem Details error. The dialog remains open and the connection, account links and credential remain unchanged so the user can retry removal. There are no background revocation retries. Removal holds the sync lease through the provider call and local update and is refused while a sync runs or a callback is still exchanging its authorization code. The final transaction removes only the exact session inspected before revocation. If a callback links a new session meanwhile, removal returns 409 without detaching accounts or deleting the new credential; retrying removal then revokes that session. The removed connection no longer appears in the list. Connecting the same bank again later maps the kept accounts through identification hashes instead of creating duplicates. Removed accounts are not converted to manual accounts and cannot be deleted yet.

Sync retrieves a rolling 89-day window, processes accounts sequentially, follows all continuation pages, and persists only booked (`BOOK`) transactions. Deduplication uses `entry_reference` per account; `transaction_id` is not reliably unique. Missing or conflicting references stop that account's import. Manual category corrections, including deliberately uncategorized transactions, survive repeat imports. Provider references and account links exist today. Each sync run in the history links to the transactions it inserted (see [architecture](architecture.md)); runs recorded before this link show their count without a list. CSV import batches, a complete provenance trail and editable transaction overrides are planned.

Every Enable Banking response is validated against the fields Ufer reads, persists or shows before it is used. A response that does not match, such as a missing session expiry, an unparseable balance date or a booking without an amount, is a 502 provider failure and nothing from it is stored. Malformed optional descriptive values such as counterparty names, account names or remittance lines are dropped instead of stopping an import. Session expiries are stored in the persisted UTC timestamp format.

Application keys stay on the server. Bank session IDs are encrypted with AES-256-GCM. Authorization callbacks bind the initiating user, exact live authentication session, active installation-workspace membership and browser secret, expire after 15 minutes, and are single-use. Back up the database and encryption key together. Financial database contents are not end-to-end encrypted.

## Data and imports

Amounts use integer minor units. Different currencies are never silently converted or summed. The dashboard separates latest known asset balances from month-filtered cash flow. Every transaction has a type (income, expense, transfer; opening balance and adjustment for manual accounts) independent of its category, and only income and expenses count toward cash flow, spending and trends. A synced booking whose counterparty IBAN belongs to another synced account becomes a transfer; otherwise new bookings start as income or expense by direction. Rules assign categories to transfers like to any other booking, and a transfer no rule matches stays uncategorized. After each sync and CSV import, a transfer and an unlinked booking with the opposite amount in the same currency on another own account at most three days apart are linked as one transfer when each has exactly one such candidate. Manual type changes, links and unlinks survive resync and imports. A person links only bookings with the exact opposite amount in the same currency at most 14 days apart; transfers with a fee or a currency exchange stay transfers without a counterpart. A transfer someone saved without a counterpart is never paired automatically afterwards. See [ADR 008](adr/decisions/008-transaction-types-and-transfers.md).

The schema includes accounts, transactions, categories, categorization rules, bank connections (`requisitions`), account identifiers, balance snapshots, sync history, leases, and login throttling. Drizzle provides typed table models, a shared database connection and versioned SQL changesets. Empty databases receive the initial schema; a recognized existing database opens without automatic schema/history changes. Existing-database adoption and future upgrades require explicit maintenance; see the [migration workflow](database-migrations.md). Individual users and active membership of one constrained installation workspace are implemented in source; independent-customer isolation and SSO remain unimplemented. See [user management](user-management.md) for the required rollout.

Manual accounts accept transactions entered in Ufer, Update balance and CSV imports. A manual account's balance is the sum of its transactions: the opening balance booked when the account is created, entered or imported transactions, transfers and adjustments ([ADR 009](adr/decisions/009-manual-account-balances-from-transactions.md)). Current imports require a fixed UTF-8 format with comma or semicolon delimiters and an optional BOM. Configurable field mapping, previews, and reusable import profiles are planned. There is no PDF importer or dedicated migration wizard for another product.

Balance snapshots record a synced account's provider balance on a given date. A manual account records a balance instead as an adjustment: Update balance and each imported balance book the difference between the entered balance and the account's balance at the end of that date, so a market value that cannot be reconstructed from cash transactions alone is kept in the account's running balance. Historical net-worth charts are planned; no history chart is available yet.

Balance-history CSV:

```csv
date;balance;currency
2026-01-15;1000.00;EUR
```

Rows are recorded oldest first. Each books an adjustment for the difference to the account's balance at the end of its date (an opening balance if the account has no transactions yet); a balance the account already has books nothing, so importing the same file again changes nothing. Later transactions keep their effect, so an older balance does not replace the current one.

Booked transactions:

```csv
id;date;amount;currency;counterparty;description
example-001;2026-01-15;-12.50;EUR;Example merchant;Example purchase
```

IDs must be stable and unique per account. Reimporting updates rather than duplicates. Imported transactions count toward the account balance. Limits: 1 MB, 10,000 rows, ISO dates, and the account's currency. Use a decimal point, or a decimal comma with semicolon delimiters, without thousands separators.

Rules match payee and description case-insensitively. Lower priority numbers win; rule ID breaks ties. Applying rules preserves manual assignments. Regular expressions use RE2 syntax without backreferences or lookbehind.


### Recorded bank balance classification

A bank balance observation retains the selected provider `balance_type` alongside its amount and date. The history source label distinguishes closing booked, interim booked, closing available, interim available, previous closing booked and expected balances; observations recorded before this provenance was retained show an unknown type. These are provider classifications, not a claim that Ufer certifies historical bank closing balances. Daily values reconstructed from transactions are labelled as estimates and do not inherit the anchor's bank classification. Selection priority is unchanged. Code meanings follow the [Enable Banking API reference](https://enablebanking.com/docs/api/reference/).


### Account display names

Open an account's details and select its heading to rename it, for both manual and bank-linked accounts. Names are trimmed and must contain 1–100 characters. Duplicate display names are allowed: immutable account IDs and provider identifiers distinguish accounts. Renaming changes no bank identity, connection, balance or transaction. Account lists and transaction labels refresh after saving.

A bank-supplied account name or product remains visible in the details as “Bank account name” when known. A reconnect may refresh that provider label but preserves the custom display name. Existing installations have no recoverable separate provider label until the bank supplies it during a later authorization; no historical name is inferred.
