# Changelog

All notable changes to Ufer are documented here. Versions follow [Semantic Versioning](https://semver.org/); each release is a version tag on `main` that deploys to the hosted production installation (see [releasing](docs/releasing.md)).

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
- Preview deployments for pull requests and a staging deployment of `main`, sharing a synthetic demo dataset (`npm run demo:seed`) and a sandbox bank connection; production deploys from version tags.

[0.1.0]: https://github.com/daberni/ufer/releases/tag/0.1.0
