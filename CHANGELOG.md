# Changelog

All notable changes to Ufer are documented here. Versions follow [Semantic Versioning](https://semver.org/); each release is tagged with its plain version (for example `0.1.0`) on `main`.

## [Unreleased]

## [0.4.0] - 2026-11-25

### Brokerage

- Brokerage accounts with securities, holdings and trades; each trade books its cash leg on a settlement account, and trades can be recorded from existing bookings.
- Daily security prices from EODHD, including stock splits; brokerage accounts count towards balances and net worth.
- A Brokerage section with time-weighted performance per account and combined, value and performance figures in one layout, and the day's change when selecting a chart point.
- Performance covers only the periods in which securities were held, and the combined history keeps accounts that have since been emptied.
- Security transfers between brokerage accounts keep their purchase history.
- Losses are shown in red, and brokerage and net-worth pages load with stable skeletons.

### Imports

- CAMT.053, OFX and QIF statement files can be imported; the CSV import is now called File import.

### Interface

- English and German interface languages with a per-browser switch.
- Labels are written in sentence case.

### Setup and operations

- Encrypted daily and monthly database backups with a freshness check.
- Every change on `main` deploys to staging; production deploys from version tags, and database migrations need an approval with a backup and a rehearsal beforehand.

## [0.3.0] - 2026-11-22

### Accounts

- Connect an existing manual account, including one created by a CSV import, to its bank; bookings you already have are kept instead of duplicated, and a removed connection leaves ordinary manual accounts.
- Bank-linked balances, history and net worth are calculated from the bookings; a difference to the balance the bank reports is shown, day by day in the balance history, and can be resolved with an adjustment.
- Disconnected bank accounts can be kept as manual accounts or deleted, and bookings on archived accounts can still be categorized and edited.
- One consistent source and sync status across all account views.

### Transactions and imports

- Bank bookings count on the day the money actually moved (value date), so card payments land on the purchase day.
- CSV imports recognize bookings from earlier imports and bank syncs, can update matched bookings, and let you decide per row about possible duplicates.
- CSV type columns map to expenses, income and transfers; Buxfer investment trades are imported as hidden bookings.
- Choose a transfer's counterpart from one list.

### Categories and rules

- Rules can be limited to one account, and the rule editor shows the bookings a rule matches.

### Interface

- More room on phones: Sync and page actions sit beside the page title, and tab bar navigation no longer fills the back history.
- Charts crossing zero show gains and losses in green and red, the net-worth chart shows changes on hover, and list pages share one heading with counts.
- Readable sync statuses, clearer labels for screen readers and a two-row footer.

### Setup and operations

- A demo household for trying Ufer out, with README screenshots of the feature set.
- The setup guide works from a fresh clone, including Docker Compose.

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

[Unreleased]: https://github.com/daberni/ufer/compare/0.4.0...main
[0.4.0]: https://github.com/daberni/ufer/releases/tag/0.4.0
[0.3.0]: https://github.com/daberni/ufer/releases/tag/0.3.0
[0.2.0]: https://github.com/daberni/ufer/releases/tag/0.2.0
[0.1.0]: https://github.com/daberni/ufer/releases/tag/0.1.0
