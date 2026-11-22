# Changelog

All notable changes to Ufer are documented here. Versions follow [Semantic Versioning](https://semver.org/); each release is tagged with its plain version (for example `0.1.0`) on `main`.

## [Unreleased]

## [0.3.0] - 2026-11-22

### Accounts

- Disconnected bank accounts can be converted to manual accounts or deleted permanently ([#264](https://github.com/daberni/ufer/pull/264)).
- Bookings on archived accounts can still be categorized, split and edited ([#272](https://github.com/daberni/ufer/pull/272)).
- Bank-linked accounts derive their balance, history and net worth from their transactions; a difference to the reported bank balance is shown and resolved with an adjustment. Changeset 0017 converts existing accounts without changing any balance ([#275](https://github.com/daberni/ufer/pull/275)).
- The balance history of a synced account shows reported bank balances and their daily difference to the calculated balance, marking where a difference starts ([#341](https://github.com/daberni/ufer/pull/341)).
- A manual account, including one created by a CSV import, can be connected to a bank account; matching bookings are adopted instead of duplicated, and removing a connection leaves manual accounts. Changeset 0021 adds the target account to bank authorizations ([#344](https://github.com/daberni/ufer/pull/344)).
- The account institution is replaced by the connection's bank name; changeset 0019 drops the column ([#317](https://github.com/daberni/ufer/pull/317)).
- Account source and sync status look the same in every account view, and the account panel compares the bank balance on its own date ([#301](https://github.com/daberni/ufer/pull/301), [#295](https://github.com/daberni/ufer/pull/295)).

### Transactions and imports

- Bank bookings count on their value date, and the bank booking date is kept separately; changeset 0018 renames the counted date ([#318](https://github.com/daberni/ufer/pull/318)).
- Split saves and mapped CSV import batches are saved atomically ([#265](https://github.com/daberni/ufer/pull/265)).
- Buxfer investment purchases and sales are imported as hidden bookings ([#270](https://github.com/daberni/ufer/pull/270)).
- CSV rows are matched against earlier imports of other files; already-imported rows are reserved and consumed matches capped ([#273](https://github.com/daberni/ufer/pull/273), [#276](https://github.com/daberni/ufer/pull/276)).
- Reimported CSV rows can update matched bookings, and possible duplicates are decided per row ([#326](https://github.com/daberni/ufer/pull/326)).
- A CSV type column maps to expense, income and transfer types ([#319](https://github.com/daberni/ufer/pull/319)).
- CSV-imported account IDs no longer depend on the banking environment; re-importing a file imported before this release creates a new account ([#335](https://github.com/daberni/ufer/pull/335)).
- A transfer's counterpart is chosen from one stacked list ([#293](https://github.com/daberni/ufer/pull/293)).

### Categories and rules

- Rules can apply only to bookings on a chosen account; changeset 0020 adds the condition ([#331](https://github.com/daberni/ufer/pull/331)).
- The rule editor separates condition and result and lists the bookings a rule matches ([#304](https://github.com/daberni/ufer/pull/304)).

### Interface

- On phones, Sync and page actions sit beside the page title as an icon button and a "…" menu, and Sync is gone from the categories page ([#340](https://github.com/daberni/ufer/pull/340)).
- Tab bar taps on phones no longer add history entries, so Back does not step through earlier tabs ([#342](https://github.com/daberni/ufer/pull/342)).
- The footer shows the app name and claim on one row and the legal links on a second ([#337](https://github.com/daberni/ufer/pull/337)).
- Readable sync statuses, plural wording, a labelled main navigation and clearer accessible names ([#339](https://github.com/daberni/ufer/pull/339)).
- Charts crossing zero draw a zero line with green and red areas, net-worth changes show on hover, list pages share one heading with counts, and recent syncs are an aligned table ([#308](https://github.com/daberni/ufer/pull/308), [#298](https://github.com/daberni/ufer/pull/298), [#303](https://github.com/daberni/ufer/pull/303), [#296](https://github.com/daberni/ufer/pull/296)).

### Operations

- Each database serves one banking environment; changeset 0016 drops the per-row environment column ([#263](https://github.com/daberni/ufer/pull/263)).
- A synthetic demo household seeds screenshots and local trials; the README shows the feature set ([#320](https://github.com/daberni/ufer/pull/320), [#323](https://github.com/daberni/ufer/pull/323)).
- The newcomer setup path works from a fresh clone, including the Compose port setting ([#336](https://github.com/daberni/ufer/pull/336)).
- Feature server boundaries are enforced by lint, and the sync lease is held during CSV imports ([#289](https://github.com/daberni/ufer/pull/289), [#287](https://github.com/daberni/ufer/pull/287)).

## [0.2.0] - 2026-11-21

### Transactions

- Split a transaction into category parts, override or hide imported transactions, record manual transactions, and edit the category, payee and description in the transaction dialog with payee suggestions.
- Transaction types (including transfers between own accounts) with a type filter; the rule that assigned a category is recorded and can be opened.

### Categories and rules

- Rules can match payee and description overrides and set transaction types and transfer accounts; rules can be reordered, deleted and created from a transaction row, and manual assignments can return to automatic categorization.
- Color and icon picker panels with a curated icon set and color suggestions from similar categories; categories can be deleted.

### Accounts

- Account details with daily balance history, renaming, changing the account type, archiving (also on bank disconnect) and editing balances.
- The overview shows the most recently booked accounts with stable loading layouts and simplified period and currency controls.

### Imports

- CSV import page with column roles, account and category mapping, saved mapping templates, Buxfer export detection and Buxfer split transactions imported as split bookings.

### Reports and interface

- Monthly cash flow with mirrored bars, a net line and the savings rate; category panel rows link to their transactions and highlight with the chart.
- Dark theme with a System, Light or Dark choice, amounts and dates in the browser's locale, a web app manifest for installation, and a shared dialog, popover and searchable select.

### Security and operations

- Content-Security-Policy and security headers, per-client authentication rate limits, server-side session revocation on password change and a security policy.
- Validated Enable Banking responses, more robust syncs, verified offline backups and preview deployments only for labelled pull requests.

## [0.1.0] - 2026-11-16

First release of Ufer, a self-hosted personal finance overview for one household.

### Accounts and net worth

- Checking, savings, credit card, investment, property and loan accounts with a grouped type choice when creating an account.
- Manual balances and valuations; net worth split into cash, investments, property and loans, with currency isolation.

### Bank connections

- Read-only bank access through Enable Banking: choose a country and bank, authorize at the bank, and sync booked transactions and balances.
- Sync from the button in the header with its own progress and result popover, a daily scheduled sync, a sync history linked to the transactions each run imported, reconnect prompts for expired authorizations, and removal of bank connections.
- Transfers between own accounts are recognized from account identifiers.

### Transactions and categories

- Transaction list with search, account, category and period filters kept in the URL, including browser back and forward.
- Categories with colors and optional icons, shown as tinted chips with an accessible category picker; categories can be edited.
- Keyword and regular-expression rules (RE2) with priorities; manual category choices are preserved across syncs and rule runs.
- Fixed-schema CSV imports for manual accounts.

### Reports

- Monthly or all-months cash flow, an income and expenses chart with per-bar category breakdowns, and a spending breakdown by category.
- A month picker and a period selection shared across views.

### Interface

- Responsive layout for desktop and phones, a rem-based type scale, shoreline illustrations for empty states and sign-in, precise dates on hover, and contextual action feedback instead of layout-shifting notices.

### Accounts, privacy and legal

- Individual username and password sign-in with owner and member roles, persisted sessions and revocation.
- Public privacy notice and terms of use for the hosted installation, configured per deployment.
- Licensed under AGPL-3.0-or-later with a link to the source code on every screen; contributions require the contributor license agreement.

### Operations

- Deployment on Vercel with a Turso (libSQL) database, versioned SQL migrations, Docker and Compose for self-hosting.
- Preview deployments for pull requests with a shared synthetic demo dataset (`npm run demo:seed`) and a sandbox bank connection.

[Unreleased]: https://github.com/daberni/ufer/compare/0.3.0...main
[0.3.0]: https://github.com/daberni/ufer/releases/tag/0.3.0
[0.2.0]: https://github.com/daberni/ufer/releases/tag/0.2.0
[0.1.0]: https://github.com/daberni/ufer/releases/tag/0.1.0
