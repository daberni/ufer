# Setup and operation

Ufer uses Next.js, React, TypeScript and SQLite/libSQL. It can run locally, in Docker on a NAS, or on Vercel with a persistent external database.

This guide covers development, deployment and verification. See [banking](banking.md) for synchronization behavior and data handling and [CSV import](csv-import.md) for file formats. Architecture, contribution conventions and schema maintenance are covered in [architecture](architecture.md), [code style](code-style.md), [decision records](adr/README.md) and [database migrations](database-migrations.md).

## Run locally

1. Install Node.js 26, run `nvm use` when using nvm, and then run `npm ci`.
2. Copy `.env.example` to `.env.local`. Configure an Enable Banking application ID, a private key outside the repository, and the exact registered callback URL. The default is `http://localhost:3000/api/banking/callback`.
3. Generate independent `BETTER_AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, and `CRON_SECRET` values using `openssl rand -hex 32`. Never commit real credentials.
4. Provision the installation owner using the operator-only [user enrollment](user-management.md#operator-enrollment), then run `npm run dev` and open [localhost:3000](http://localhost:3000). Keep the same hostname and browser throughout bank authorization.
5. Open Bank connections, authorize a sandbox institution, then select Sync to retrieve balances and booked transactions.

The development server binds to loopback. Username/password sign-in and `BETTER_AUTH_SECRET` are required in every environment. `APP_URL` must match the browser origin because write requests validate their origin. A production server (Docker, or `NODE_ENV=production`) refuses to start unless `APP_URL` is an HTTPS origin, so serve Docker installations through an HTTPS reverse proxy.

JSON API request bodies above 2 MiB are rejected with 413 while they are read; CSV imports allow 1 MB of CSV text. Other request size limits come from the hosting layer: Vercel caps bodies at 4.5 MB, and a reverse proxy sets its own limit (nginx defaults to 1 MB; raise `client_max_body_size` to `2m` for full-size CSV imports).

## Demo data

`npm run demo:seed -- --confirm` writes a synthetic English dataset into the database configured by `DATABASE_URL`, so the dashboard, charts, filters and rules can be reviewed without a bank connection. It needs no Enable Banking credentials and never runs at build or startup.

- **Content:** about 18 months ending on the run date (Europe/Vienna) for ten accounts of one household: an everyday checking account, a joint household account and an emergency fund at one bank, an online current account at a second bank, a credit card, a cash wallet, an ETF portfolio, a rental flat, a family car and the flat's mortgage. It includes salary with holiday and Christmas bonuses, rent, rental income, utilities, insurance, subscriptions, groceries, car costs, transport, dining, leisure, health, a summer holiday and short trips (one paid in pounds), December gifts, larger one-off purchases, refunds, three split purchases, interest and dividends, card statements, ATM withdrawals, transfers between the demo accounts linked in pairs, special loan repayments whose counterpart Ufer created on the manual mortgage account, a monthly transfer to an untracked savings account, monthly portfolio valuations, quarterly property and car valuations and amortizing loan interest. Seventeen enabled rules and eight added categories categorize all but about ten income and expense rows; one paused rule shows a disabled state. Amounts are EUR; all names, institutions and IBANs are fictional, and the IBANs use bank codes no Austrian bank uses.
- **Simulated bank connections:** the checking, joint, savings and credit card accounts belong to three linked connections with a reported balance, a last sync time and two weeks of daily sync history in which one run failed for one account and the next run recovered. The connections hold no provider session; sync skips demo accounts and removing a demo connection revokes nothing, so they never contact Enable Banking.
- **Reproducible:** the same run date produces the same rows. Re-run the command when the history should end today again. `--date=YYYY-MM-DD` (today or earlier) reproduces the dataset of another day.
- **Scope:** demo rows have `demo-` IDs; their transactions carry `demo:` references, or `bank:demo:` on the simulated bank accounts so their sync runs list them. A run replaces, in one transaction, the demo accounts with every transaction, split and balance snapshot on them, the demo connections, the demo sync runs and the demo rules. Demo categories are updated in place because synced transactions may reference them; when a category with the same name already exists, the demo rules use it instead. Users, sessions, other bank connections, their accounts and transactions, other sync history and all other rows stay untouched.
- **Guard:** the command refuses to run without `--confirm`, when `ENABLE_BANKING_ENVIRONMENT` is not `SANDBOX`, or when a manual or CSV account the seed did not create holds transactions. Sandbox bank-connected data does not block it. Manual accounts without transactions, such as a test valuation, are allowed.

To seed a local throwaway database, point `DATABASE_URL` at a new file, for example `DATABASE_URL=file:data/demo.db npm run demo:seed -- --confirm`, then provision a user with the operator [user enrollment](user-management.md#operator-enrollment) and start the app with the same `DATABASE_URL`. An empty database is initialized with the checked-in changesets first; an existing database with pending migrations is refused as at application startup. Seeding the shared preview database is described in the [deployment guide](vercel-deployment.md#preview-demo-data).

## Screenshots

`npm run screenshots` regenerates the README images in `docs/screenshots/` from scratch. It creates a temporary database, fills it with the demo data ending today, enrolls a throwaway user with a random password held only in memory, starts a development server on `127.0.0.1:3917` (`SCREENSHOT_PORT` overrides it) and captures each view at 1440 px (desktop) and 390 px (phone) in the light theme, plus the overview in the dark theme, as WebP. Afterwards it stops the server and deletes the database and secrets. It ignores `.env` and needs no Enable Banking credentials. The seed runs in the sandbox environment; the server that renders the screenshots runs as a configured production installation with a throwaway application ID and key that no provider knows, so the images show no sandbox marker or configuration notice. The captured views make no provider request: sync skips demo accounts and the bank directory loads only when the connect dialog opens.

It needs Google Chrome; set `CHROME_PATH` to another Chromium-based browser. Stop other development servers of the same checkout first, because they share the `.next` build directory. Review the images before committing them: they show the current UI and the dates of the run day.

## Docker / NAS

1. Copy `.env.example` to `.env`, configure all secrets including `BETTER_AUTH_SECRET`, and set `ENABLE_BANKING_PRIVATE_KEY_HOST_PATH` to an external PEM file. Compose mounts it read-only as a secret.
2. Set `APP_URL` and the registered callback to the HTTPS address of the reverse proxy that serves Ufer, for example on the NAS. `BIND_ADDRESS` defaults to `127.0.0.1`, so only a proxy on the same host reaches the application; bind the LAN address only when the proxy runs on another host.
   Behind a reverse proxy that replaces a client-address header with the connecting address (for example nginx `proxy_set_header X-Real-IP $remote_addr;`), set `TRUSTED_CLIENT_IP_HEADER=X-Real-IP` so authentication rate limits count per client. Only set it when the application port is reachable exclusively through that proxy. Without it, all clients share one counter per authentication endpoint; see [authentication rate limits](security.md#authentication-rate-limits).
3. Run `docker compose up -d --build`. The application runs as a non-root user with a read-only root filesystem and a persistent `budget-data` volume. The existing volume and database names are intentionally retained for compatibility.
4. Unattended daily synchronization is included in the default Compose stack. It runs once in the configured hour, default 06:00 Europe/Vienna; set `SYNC_HOUR` to change the hour. There is no immediate retry loop on failure.
5. For a consistent backup, stop the app and scheduler, back up the data volume and configuration/encryption secrets separately, then restart. Copying an actively written SQLite file is not a verified backup procedure. See [backup and restore](backup-and-restore.md) for read-only artifact checks and the separately authorized recovery procedure.

The image build excludes environment files, private keys, and financial databases. Outbound HTTPS to Enable Banking is required. No incoming webhook is required; the registered callback must be reachable from the user's browser. Production redirect compatibility depends on the institution.

A local macOS Docker test encountered `EPERM` reading an externally mounted key. Passing the key through the supported `ENABLE_BANKING_PRIVATE_KEY` server secret worked. Verify secret mount permissions on the actual NAS. Do not place a private key in the build context.

## Vercel

Use persistent external libSQL through `DATABASE_URL=libsql://…` and `DATABASE_AUTH_TOKEN`. Local SQLite files and `/tmp` are not persistent on Vercel; the application rejects that configuration. PostgreSQL support is planned, not implemented.

Set `BETTER_AUTH_SECRET`, `DATA_ENCRYPTION_KEY`, `CRON_SECRET`, the banking application ID, and `ENABLE_BANKING_PRIVATE_KEY` as hosting secrets. Use a PEM value rather than a local key path. Set the application and callback URLs to the deployment origin. Provision individual users through the [operator enrollment workflow](user-management.md#operator-enrollment). This version serves one shared financial workspace; it does not implement multi-customer SaaS isolation.

`vercel.json` configures a daily 05:00 UTC cron call authenticated with `CRON_SECRET`. The route has `maxDuration=300`; provider latency and many accounts can exceed platform runtime limits. An observed unattended scheduled sync and NAS operation remain unverified ([#267](https://github.com/daberni/ufer/issues/267)). See the [deployment guide](vercel-deployment.md) for configuration, cost boundaries and acceptance evidence. Unattended synchronization is a required capability on every supported hosting platform.

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

All five views were checked in Chrome emulation at widths from 320 to 844 pixels and desktop at 1440 pixels. Physical devices, Safari, on-screen keyboards, and bank-app redirects remain to be verified. A web app manifest makes Ufer installable; offline support is not implemented.

## Checks

Run the checks listed in [contributing](../CONTRIBUTING.md#making-a-change) before submitting a change.

## Parallel checkouts

Repository checks exclude local .claude worktrees so separate agent checkouts do not become application inputs or lint/type-check targets. Keep unrelated work in separate checkouts and preserve existing uncommitted changes.
