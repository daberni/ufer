# Vercel deployment

Ufer deploys as a Next.js application with Node.js and a persistent external SQLite-compatible libSQL database. The project configuration selects Frankfurt (`fra1`) for application functions. A Turso Starter resource in Dublin (`dub1`) is the current hosting choice; PostgreSQL is not required or implemented.

## Account and cost boundary

Use the existing Vercel Hobby account and Turso Starter plan. Do not select paid upgrades, plans with overages or paid add-ons without a separate approval. Provider limits and terms remain authoritative; stop before a change that would introduce a charge. A database attached to the Vercel production environment can still contain only synthetic bank sandbox data; these are different environment concepts.

## Configuration

| Setting | Purpose |
| --- | --- |
| Node.js | 26.x for local development, CI, Docker, scheduler and Vercel |
| Install / build | `npm ci` / `npm run build` |
| APP_URL | Actual HTTPS application origin |
| DATABASE_URL | Persistent `libsql://` URL, not a local file or temporary directory |
| ENABLE_BANKING_ENVIRONMENT | SANDBOX until production banking access is separately accepted |
| ENABLE_BANKING_REDIRECT_URL | APP_URL followed by `/api/banking/callback`; register it with the provider |

| Secret | Purpose |
| --- | --- |
| APP_PASSWORD | Temporary installation access until individual-user authentication ships |
| SESSION_SECRET | Installation cookie sealing; use a dedicated random value |
| DATA_ENCRYPTION_KEY | 64 hexadecimal characters; preserve it with the database backup |
| CRON_SECRET | Authentication for the daily scheduled sync |
| DATABASE_AUTH_TOKEN | Authentication for the remote libSQL database |
| ENABLE_BANKING_APP_ID / ENABLE_BANKING_PRIVATE_KEY | Operator's matching provider application and PEM key; no local key-file path on Vercel |

Turso's integration supplies TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. Map their values to the generic DATABASE_URL and DATABASE_AUTH_TOKEN expected by Ufer. Keep production credentials in the operator's password manager and Vercel's environment secret store. Never commit them, print them, upload local environment files or embed them in the browser bundle. Provision separate production, preview and local data/secrets; do not attach production financial data to unrestricted previews.

## Initialization and deployment

1. Link the local checkout to the intended Vercel project. The generated `.vercel/` metadata stays ignored. If the CLI offers to download environment values into the checkout, decline; remove only tool-generated local tokens that were not part of the app configuration.
2. Configure the persistent database and required secrets. Initialize a new, empty database once using the reviewed baseline before concurrent web traffic. Upgrades of existing databases require the separate [migration workflow](database-migrations.md).
3. Deploy the reviewed source with `vercel deploy --prod`. A deployment request does not grant permission to commit or push unrelated changes. `.vercelignore` excludes local environment files, private keys, databases, build output and artifacts from uploads.
4. Verify the HTTPS origin, session-cookie attributes, login/logout, protected API responses, persisted data across deployments and server-only error handling. Check bank authorization and callback registration separately before claiming bank synchronization acceptance.
5. Inspect the scheduled trigger and exercise its authenticated endpoint. The configured cron runs daily at 05:00 UTC; that is 06:00 Vienna in winter and 07:00 in summer. An endpoint check does not prove a future unattended scheduled run.

The current installation is one shared workspace protected by an installation password. It is not a multi-customer service. Username/password identities, enrollment and workspace authorization require a reviewed authentication-library integration and explicit schema migrations; see [architecture](architecture.md).

## Verification status

Verified on 2026-11-15: Vercel production is Ready on Node 26 with functions in Frankfurt and the approved Turso Starter database initialized from the existing baseline. Login/logout, Secure/HttpOnly/SameSite session attributes, origin rejection, protected Problem Details responses and remote persistence passed. Both hosted and local bank callbacks are registered. A Mock ASPSP sandbox connection contains one account and two test transactions; a repeat sync inserted zero additional transactions.

Vercel records an enabled daily 05:00 UTC cron definition, and its bearer-protected endpoint completed an authenticated sync. The first future unattended scheduled invocation has not been observed. No local financial data was imported. Real-bank coverage, physical-device flows, NAS operation, backup restoration and multi-customer isolation remain separate acceptance work.

The production project is connected to the private repository's main branch. Approved pushes to that branch trigger deployment of the matching runtime and deployment configuration. Individual identities remain a separate [architecture change](architecture.md#sso-ready-identity-boundary) and are not enabled by this deployment.
