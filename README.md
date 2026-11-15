# Ufer

A personal finance dashboard for accounts, transactions, and net worth. Built with Next.js, React, TypeScript, and SQLite/libSQL, with Docker/NAS and Vercel deployment paths.

**Early development:** bank authorization and synchronization have been exercised with sandbox data. Live bank coverage, production hosting, and backup restoration still require validation. This project is currently private; an open-source license has not been selected.

See the [feature comparison and roadmap](docs/feature-comparison.md) for current capabilities and the [product and architecture direction](docs/product-direction.md) for accepted requirements and proposed hosting choices. Documentation, source code, UI copy, and contributor communication in the repository use English.

## Run locally

1. Install Node.js 22 or newer and run `npm ci`.
2. Copy `.env.example` to `.env.local`. Configure an Enable Banking application ID, a private key outside the repository, and the exact registered callback URL. The default is `http://localhost:3000/api/banking/callback`.
3. Generate independent `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, and `CRON_SECRET` values using `openssl rand -hex 32`. Never commit real credentials.
4. Run `npm run dev` and open [localhost:3000](http://localhost:3000). Keep the same hostname and browser throughout bank authorization.
5. Open Bank connections, authorize a sandbox institution, then select Sync to retrieve balances and booked transactions.

The development server binds to loopback. `APP_PASSWORD` enables local sign-in and is required in production. `APP_URL` must match the browser origin because write requests validate their origin.

## Bank synchronization

The current provider is [Enable Banking](https://enablebanking.com/docs/api/reference/). Ufer uses account information endpoints only: application JWTs, institution discovery, authorization, sessions, balances, and paginated transactions. It does not initiate payments.

Sandbox and production data are isolated. Sandbox institutions do not establish production bank coverage. Live access requires a production application and the provider's account-linking or commercial onboarding process. [Restricted own-account access](https://enablebanking.com/docs/api/linked-accounts/) is intended for evaluation and individual non-commercial use; it is not a contract for a hosted SaaS product.

Authorizations expire according to the institution's consent duration. The UI warns seven days before expiry and supports reconnecting. Stable identification hashes match reconnects to existing accounts; a changed account currency prevents automatic remapping.

Sync retrieves a rolling 89-day window, processes accounts sequentially, follows all continuation pages, and persists only booked (`BOOK`) transactions. Deduplication uses `entry_reference` per account; `transaction_id` is not reliably unique. Missing or conflicting references stop that account's import. Manual category corrections, including deliberately uncategorized transactions, survive repeat imports. Provider references and account links exist today; a complete per-import provenance trail and editable transaction overrides are planned.

Application keys stay on the server. Bank session IDs are encrypted with AES-256-GCM. Authorization callbacks are browser-bound, expire after 15 minutes, and are single-use. Back up the database and encryption key together. Financial database contents are not end-to-end encrypted.

## Data and imports

Amounts use integer minor units. Different currencies are never silently converted or summed. The dashboard separates latest known asset balances from month-filtered cash flow. Categorized transfers are excluded from income and expenses; transfers to known owned IBANs are identified automatically.

The schema includes accounts, transactions, categories, categorization rules, bank connections (`requisitions`), account identifiers, balance snapshots, sync history, leases, and login throttling. Initialization uses `CREATE TABLE IF NOT EXISTS`; versioned schema upgrades are not implemented. Existing records and customized category names are not rewritten by initialization.

Manual valuations and CSV imports are available. Current imports require a fixed UTF-8 format with comma or semicolon delimiters and an optional BOM. Configurable field mapping, previews, and reusable import profiles are planned. There is no PDF importer or dedicated migration wizard for another product.

Balance snapshots:

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

Rules match payee and description case-insensitively. Lower priority numbers win; rule ID breaks ties. Applying rules preserves manual assignments. Regular expressions use RE2 syntax without backreferences or lookbehind.

## Smartphone support

Small screens use labeled bottom navigation, transaction cards with expandable descriptions, and scrollable bottom-sheet forms. Larger touch targets, 16-pixel form text, and safe-area spacing support smartphone use. Desktop retains tables and a sidebar.

All five views were checked in Chrome emulation at widths from 320 to 844 pixels and desktop at 1440 pixels. Physical devices, Safari, on-screen keyboards, and bank-app redirects remain to be verified. Offline support and an installable PWA are not implemented.

## Docker / NAS

1. Copy `.env.example` to `.env`, configure all secrets including `APP_PASSWORD`, and set `ENABLE_BANKING_PRIVATE_KEY_HOST_PATH` to an external PEM file. Compose mounts it read-only as a secret.
2. Set `APP_URL` and the registered callback to the actual LAN or reverse-proxy address. `BIND_ADDRESS` defaults to `127.0.0.1`; explicitly configure the NAS LAN address for direct LAN access.
3. Run `docker compose up -d --build`. The application runs as a non-root user with a read-only root filesystem and a persistent `budget-data` volume. The existing volume and database names are intentionally retained for compatibility.
4. Unattended daily synchronization is included in the default Compose stack. It runs once in the configured hour, default 06:00 Europe/Vienna; set `SYNC_HOUR` to change the hour. There is no immediate retry loop on failure.
5. For a consistent backup, stop the app and scheduler, back up the data volume and configuration/encryption secrets separately, then restart. Copying an actively written SQLite file is not a verified backup procedure.

The image build excludes environment files, private keys, and financial databases. Outbound HTTPS to Enable Banking is required. No incoming webhook is required; the registered callback must be reachable from the user's browser. Production redirect compatibility depends on the institution.

A local macOS Docker test encountered `EPERM` reading an externally mounted key. Passing the key through the supported `ENABLE_BANKING_PRIVATE_KEY` server secret worked. Verify secret mount permissions on the actual NAS. Do not place a private key in the build context.

## Vercel

Use persistent external libSQL through `DATABASE_URL=libsql://…` and `DATABASE_AUTH_TOKEN`. Local SQLite files and `/tmp` are not persistent on Vercel; the application rejects that configuration. PostgreSQL support is planned, not implemented.

Set `APP_PASSWORD`, `SESSION_SECRET`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET`, the banking application ID, and `ENABLE_BANKING_PRIVATE_KEY` as hosting secrets. Use a PEM value rather than a local key path. Set the application and callback URLs to the deployment origin. The current login is for a single shared workspace, not SaaS tenant isolation.

`vercel.json` configures a daily 05:00 UTC cron call authenticated with `CRON_SECRET`. The route has `maxDuration=300`; provider latency and many accounts can exceed platform runtime limits. Actual Vercel deployment and scheduler behavior have not been verified. Unattended synchronization is a required capability on every supported hosting platform.

## Checks

```sh
npm run check
npm test
npm run build
```

The behavior tests cover exact amounts, accounting month boundaries, rule precedence, booked versus pending transactions, provider identifiers, CSV validation, repeat imports, manual categories, reconnects, environment isolation, leases, authentication throttling, encrypted sessions, pagination, and browser-bound single-use callbacks. CI runs type checking, behavior tests, and a production build without real banking credentials.
