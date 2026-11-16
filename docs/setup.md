# Setup and operation

Ufer uses Next.js, React, TypeScript and SQLite/libSQL. It can run locally, in Docker on a NAS, or on Vercel with a persistent external database.

This guide covers development, deployment and verification. See [banking and imports](banking-and-imports.md) for synchronization behavior, data handling and CSV formats. Architecture, contribution conventions and schema maintenance are covered in [architecture](architecture.md), [code style](code-style.md), [decision records](adr/README.md) and [database migrations](database-migrations.md).

## Run locally

1. Install Node.js 26, run `nvm use` when using nvm, and then run `npm ci`.
2. Copy `.env.example` to `.env.local`. Configure an Enable Banking application ID, a private key outside the repository, and the exact registered callback URL. The default is `http://localhost:3000/api/banking/callback`.
3. Generate independent `BETTER_AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, and `CRON_SECRET` values using `openssl rand -hex 32`. Never commit real credentials.
4. Provision the installation owner using the operator-only [user enrollment](user-management.md#operator-enrollment), then run `npm run dev` and open [localhost:3000](http://localhost:3000). Keep the same hostname and browser throughout bank authorization.
5. Open Bank connections, authorize a sandbox institution, then select Sync to retrieve balances and booked transactions.

The development server binds to loopback. Username/password sign-in and `BETTER_AUTH_SECRET` are required in every environment. Existing installations need the reviewed [authentication migration](user-management.md#migration-and-rollout) before starting this version. `APP_URL` must match the browser origin because write requests validate their origin.

## Docker / NAS

1. Copy `.env.example` to `.env`, configure all secrets including `BETTER_AUTH_SECRET`, and set `ENABLE_BANKING_PRIVATE_KEY_HOST_PATH` to an external PEM file. Compose mounts it read-only as a secret.
2. Set `APP_URL` and the registered callback to the actual LAN or reverse-proxy address. `BIND_ADDRESS` defaults to `127.0.0.1`; explicitly configure the NAS LAN address for direct LAN access.
3. Run `docker compose up -d --build`. The application runs as a non-root user with a read-only root filesystem and a persistent `budget-data` volume. The existing volume and database names are intentionally retained for compatibility.
4. Unattended daily synchronization is included in the default Compose stack. It runs once in the configured hour, default 06:00 Europe/Vienna; set `SYNC_HOUR` to change the hour. There is no immediate retry loop on failure.
5. For a consistent backup, stop the app and scheduler, back up the data volume and configuration/encryption secrets separately, then restart. Copying an actively written SQLite file is not a verified backup procedure.

The image build excludes environment files, private keys, and financial databases. Outbound HTTPS to Enable Banking is required. No incoming webhook is required; the registered callback must be reachable from the user's browser. Production redirect compatibility depends on the institution.

A local macOS Docker test encountered `EPERM` reading an externally mounted key. Passing the key through the supported `ENABLE_BANKING_PRIVATE_KEY` server secret worked. Verify secret mount permissions on the actual NAS. Do not place a private key in the build context.

## Vercel

Use persistent external libSQL through `DATABASE_URL=libsql://…` and `DATABASE_AUTH_TOKEN`. Local SQLite files and `/tmp` are not persistent on Vercel; the application rejects that configuration. PostgreSQL support is planned, not implemented.

Set `BETTER_AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET`, the banking application ID, and `ENABLE_BANKING_PRIVATE_KEY` as hosting secrets. Use a PEM value rather than a local key path. Set the application and callback URLs to the deployment origin. Provision individual users through the [operator enrollment workflow](user-management.md#operator-enrollment). This version serves one shared financial workspace; it does not implement multi-customer SaaS isolation.

`vercel.json` configures a daily 05:00 UTC cron call authenticated with `CRON_SECRET`. The route has `maxDuration=300`; provider latency and many accounts can exceed platform runtime limits. Vercel runtime, HTTPS authentication, the sandbox callback/sync and the authenticated cron endpoint have been verified. The enabled schedule runs at 05:00 UTC; its first future unattended invocation and actual NAS operation remain unverified. See the [deployment guide](vercel-deployment.md) for configuration, cost boundaries and acceptance evidence. Unattended synchronization is a required capability on every supported hosting platform.

## Privacy notice and terms

`/privacy` and `/terms` are public pages, reachable without signing in and linked from the sign-in screen and the dashboard footer. They render the operator details and service providers from server-side environment variables at request time. Until all required values are valid, both pages state that the operator details are not configured and name the variables to set, so an unconfigured installation cannot be mistaken for a registrable one.

| Variable | Meaning |
| --- | --- |
| OPERATOR_NAME | Required. Name of the person or organization operating the installation (the GDPR controller) |
| OPERATOR_RESIDENCE | Required. Place of residence or seat as municipality and country; no street address |
| OPERATOR_EMAIL | Optional. Contact email for privacy requests and questions about the terms. Without it, the pages tell users to contact the operator the way they were given access |
| DATA_PROCESSORS | Required. JSON array of providers that process data for this installation, each with `name`, `purpose` and `location`; `[]` when the installation uses no external hosting or database provider. The privacy notice points to these entries for log and backup retention, so state retention periods in `purpose` where they are known |

Enable Banking is named in the text because the bank integration always uses it. The terms name Austrian law as the governing law. Hosting and database providers depend on the deployment, so they belong in DATA_PROCESSORS. A Docker/NAS installation on the operator's own hardware sets `[]`. Never commit real values; examples use synthetic data such as:

```sh
OPERATOR_NAME="Example Operator"
OPERATOR_RESIDENCE="Example City, Example Country"
OPERATOR_EMAIL=operator@example.test
DATA_PROCESSORS='[{"name":"Example Hosting","purpose":"Runs the application.","location":"Example Region"}]'
```

The texts carry a last-updated date maintained in their components; change it together with the text.

## Smartphone support

Small screens use labeled bottom navigation, transaction cards with expandable descriptions, and scrollable bottom-sheet forms. Larger touch targets, 16-pixel form text, and safe-area spacing support smartphone use. Desktop retains tables and a sidebar.

All five views were checked in Chrome emulation at widths from 320 to 844 pixels and desktop at 1440 pixels. Physical devices, Safari, on-screen keyboards, and bank-app redirects remain to be verified. Offline support and an installable PWA are not implemented.

## Checks

```sh
npm run lint
npm run check:styles
npm run check
npm test
npm run build
```

The behavior tests cover exact amounts, accounting month boundaries, rule precedence, booked versus pending transactions, provider identifiers, CSV validation, repeat imports, manual categories, reconnects, environment isolation, leases, authentication throttling, library-managed enrollment, membership access, cookie integrity/expiry and session revocation, jose provider signatures, persisted bank-secret integrity, pagination, and browser-bound single-use callbacks. CI runs lint, stylesheet checks, type checking, behavior tests, and a production build without real banking credentials. See [security boundaries](security.md) for the current single-installation scope and future identity requirements.

## Parallel checkouts

Repository checks exclude local .claude worktrees so separate agent checkouts do not become application inputs or lint/type-check targets. Keep unrelated work in separate checkouts and preserve existing uncommitted changes.
