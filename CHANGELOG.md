# Changelog

All notable changes to Ufer are documented here. Versions follow [Semantic Versioning](https://semver.org/); each release is tagged with its plain version (for example `0.1.0`) on `main`.

## [Unreleased]

### Accounts

- Disconnected bank accounts can be converted to manual accounts or deleted permanently ([#264](https://github.com/daberni/ufer/pull/264)).
- Bookings on archived accounts can still be categorized, split and edited ([#272](https://github.com/daberni/ufer/pull/272)).
- Bank-linked accounts derive their balance, history and net worth from their transactions; a difference to the reported bank balance is shown and resolved with an adjustment. Changeset 0017 converts existing accounts without changing any balance ([#275](https://github.com/daberni/ufer/pull/275)).

### Transactions and imports

- Split saves and mapped CSV import batches are saved atomically ([#265](https://github.com/daberni/ufer/pull/265)).
- Buxfer investment purchases and sales are imported as hidden bookings ([#270](https://github.com/daberni/ufer/pull/270)).
- CSV rows are matched against earlier imports of other files ([#273](https://github.com/daberni/ufer/pull/273)).

### Operations

- Each database serves one banking environment; changeset 0016 drops the per-row environment column ([#263](https://github.com/daberni/ufer/pull/263)).

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

[Unreleased]: https://github.com/daberni/ufer/compare/0.2.0...main
[0.2.0]: https://github.com/daberni/ufer/releases/tag/0.2.0
[0.1.0]: https://github.com/daberni/ufer/releases/tag/0.1.0
