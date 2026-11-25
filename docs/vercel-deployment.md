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
| OPERATOR_NAME / OPERATOR_RESIDENCE | Operator name and place of residence (municipality and country) shown on `/privacy` and `/terms`; required before supplying those URLs for provider registration |
| OPERATOR_EMAIL | Optional contact email for the same pages |
| DATA_PROCESSORS | JSON list of the hosting and database providers of this deployment; see [setup](setup.md#privacy-notice-and-terms) |
| TRUSTED_CLIENT_IP_HEADER | `x-forwarded-for`, which Vercel overwrites with the client address; enables per-client authentication rate limits, see [security](security.md#authentication-rate-limits) |

| Secret | Purpose |
| --- | --- |
| BETTER_AUTH_SECRET | Required library authentication secret, at least 32 characters; independent from bank-secret encryption |
| DATA_ENCRYPTION_KEY | 64 hexadecimal characters; preserve it with the database backup |
| CRON_SECRET | Authentication for the daily scheduled sync and price update |
| MARKET_DATA_API_KEY | Optional EODHD token for daily security prices; without it the price update does nothing and securities show "No price source configured" |
| DATABASE_AUTH_TOKEN | Authentication for the remote libSQL database |
| ENABLE_BANKING_APP_ID / ENABLE_BANKING_PRIVATE_KEY | Operator's matching provider application and PEM key; no local key-file path on Vercel |

Turso's integration supplies TURSO_DATABASE_URL and TURSO_AUTH_TOKEN. Map their values to the generic DATABASE_URL and DATABASE_AUTH_TOKEN expected by Ufer. Keep production credentials in the operator's password manager and Vercel's environment secret store. Never commit them, print them, upload local environment files or embed them in the browser bundle. Provision separate production, preview and local data/secrets; do not attach production financial data to unrestricted previews.

For this deployment, DATA_PROCESSORS lists Vercel and Turso with the regions above, for example:

```json
[
  {"name": "Vercel", "purpose": "Hosts and runs the application; keeps runtime logs for one hour on the Hobby plan.", "location": "Frankfurt, Germany (fra1) for application functions; requests pass through Vercel's global network"},
  {"name": "Turso", "purpose": "Stores the database.", "location": "Dublin, Ireland"}
]
```

Update it when a provider, region, plan or retention period changes. The one-hour log retention is Vercel's documented [runtime-log limit](https://vercel.com/docs/logs/runtime) for Hobby (checked 2026-11-16); add the Turso backup retention of the plan in use once confirmed. Operator details are entered in Vercel's environment settings only, never in the repository.

Preview deployments use their own Turso database and secrets in Vercel's Preview environment. Leave APP_URL unset there: sign-in and write requests accept the preview's branch alias and deployment URL, which Vercel provides as VERCEL_BRANCH_URL and VERCEL_URL. Production still accepts only APP_URL, and the server refuses to start in production (`VERCEL_ENV=production`, or `NODE_ENV=production` outside Vercel) unless APP_URL is an HTTPS origin.

The bank callback URL is `<application origin>/api/banking/callback`, where the origin is APP_URL or, on a preview without APP_URL, the preview's branch alias (ENABLE_BANKING_REDIRECT_URL overrides it). Preview URLs change and cannot be registered as provider callbacks, so a preview cannot start a bank authorization itself; register only the production callback and the local `localhost` callback with the provider. Instead, the shared preview database holds one Enable Banking sandbox (Mock ASPSP) connection, authorized from a local instance that uses the preview database, the Preview DATA_ENCRYPTION_KEY, the sandbox application and its registered `localhost` callback. Every preview shows that connection and can sync it, because syncing needs no callback. Renew it the same way before the authorization expires (Mock ASPSP grants 180 days). Vercel does not return sensitive values, so the Preview DATA_ENCRYPTION_KEY and the sandbox application key are kept in the operator's password manager.

Vercel builds nothing from Git: `git.deploymentEnabled` in `vercel.json` is `false`, so pushes create no deployments by themselves. Production deploys only from version tags through the [release workflow](releasing.md), and every push to `main` deploys a preview build behind the staging alias through the staging workflow. A pull request gets a preview on demand: a maintainer adds the `preview` label, and the [preview workflow](../.github/workflows/preview.yml) deploys the pull request's head commit with the Vercel CLI, then again on every push while the label stays, and keeps one comment with the current preview URL. Removing the label stops further previews. The workflow uses the `VERCEL_TOKEN` repository secret, a Vercel access token with the Full Account scope (`vercel alias` and `vercel promote` look up the token's user, which a team-scoped token cannot read; the commands pass the team with `--scope`), and the `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` repository variables; pull requests from forks never receive it and are not deployed, and neither are pushes by Dependabot; remove and re-add the label to deploy a Dependabot update. Renew the token before it expires and replace the secret with `gh secret set VERCEL_TOKEN`. The staging and release workflows use the same token and variables; also replace the token in the `staging` and `release` environments if they hold their own copy.

## Preview demo data

Preview deployments build the exact pull request head commit, independently of feature-branch names that may disappear after a squash merge. The bot comment links that commit and the preview URL; Vercel metadata records `previewHeadSha`. Update stacked branches before deploying when they need changes from their base. Existing migration/checksum verification remains in force: deployments neither upgrade the shared database nor bypass an incompatible schema.

Preview deployments share one persistent Turso preview database. Never bypass migration verification or rewrite applied changesets to make an older preview start. An existing immutable preview URL keeps its old code; use the replacement preview after stack integration.

Staging is a preview deployment of `main` behind a fixed alias, with APP_URL set to that alias; Vercel metadata records `stagingSha`. It shares the preview database and the staging workflow migrates it to `main`'s schema on every merge. A labeled pull-request preview therefore starts only when its branch contains all of `main`'s changesets and adds none: rebase a stale branch before relabeling it, and never apply a pull request's unmerged changeset to the shared database. Fill the preview database with the synthetic [demo dataset](setup.md#demo-data) from an operator machine; nothing seeds it automatically at build or startup. Re-run the same command when the history should end today again; it replaces only the demo rows and keeps users, sandbox bank connections and their transactions.

1. Obtain the preview database URL and token from the operator's password manager. All database variables in Vercel, including the Turso integration's TURSO_DATABASE_URL and TURSO_AUTH_TOKEN, are sensitive and cannot be pulled; the password manager keeps a copy per environment. Use them as `DATABASE_URL` and `DATABASE_AUTH_TOKEN` together with `ENABLE_BANKING_ENVIRONMENT=SANDBOX`, without writing them into the checkout.
2. Export these values in the shell; exported variables take precedence over local `.env*` files. Confirm that `DATABASE_URL` names the preview database, not production.
3. Run `npm run demo:seed -- --confirm` from a checkout of the reviewed source. The command prints the date range and the number of demo accounts, transactions, uncategorized rows and rules.
4. Unset the variables.

The guard refuses databases with non-sandbox banking data or transactions on manual or CSV accounts the seed did not create. Reviewer-created manual accounts with imported transactions therefore block a later run until those rows are removed. Never run the seed against the production database.

## Initialization and deployment

1. Link the local checkout to the intended Vercel project. The generated `.vercel/` metadata stays ignored. If the CLI offers to download environment values into the checkout, decline; remove only tool-generated local tokens that were not part of the app configuration.
2. Configure the persistent database and required secrets. Initialize a new, empty database once using the reviewed baseline before concurrent web traffic. Upgrades of existing databases require the separate [migration workflow](database-migrations.md).
3. Deploy the reviewed source with `vercel deploy --prod`. A deployment request does not grant permission to commit or push unrelated changes. `.vercelignore` excludes local environment files, private keys, databases, build output and artifacts from uploads.
4. Verify the HTTPS origin, session-cookie attributes, login/logout, protected API responses, persisted data across deployments and server-only error handling. Check bank authorization and callback registration separately before claiming bank synchronization acceptance.
5. Inspect the scheduled trigger and exercise its authenticated endpoint. The configured cron runs daily at 05:00 UTC; that is 06:00 Vienna in winter and 07:00 in summer. An endpoint check does not prove a future unattended scheduled run.

Ufer uses Better Auth username/password identities and active membership of one installation workspace; it is not a multi-customer service.

## Request timing

API routes handled through the shared `respond()` boundary answer with a `Server-Timing` header (the authentication handler, the bank callback redirect and the 404 fallback do not): `auth` (session and membership lookup), `action` (the route's own work), `db` (database calls in the request with their summed duration; concurrent calls overlap) and `total`. Browser developer tools show it per request, so a slow view can be traced to session lookup, query count or provider calls. With functions in `fra1` and the database in another region, each database call adds a network round trip; an authenticated request usually needs three for the session, user and membership before its own queries. Warm and cold timings from the hosted deployment have not been recorded yet.

## Verification status

Production runs on Vercel (Node 26, functions in Frankfurt) with a Turso database migrated through changeset 0016, username/password identities and one enrolled owner. ENABLE_BANKING_ENVIRONMENT is PRODUCTION with a restricted-mode Enable Banking application; two production institutions are connected and synced. Session-cookie attributes, origin rejection, protected Problem Details responses, remote persistence and the bearer-protected cron endpoint were verified. Production deploys from version tags through the release workflow. The shared preview database holds the demo dataset and a sandbox connection.

Open items:

- An observed unattended scheduled sync, repeat syncs and reauthorization with production banks ([#267](https://github.com/daberni/ufer/issues/267)).
- A database restore trial and automated backups ([#84](https://github.com/daberni/ufer/issues/84)).
- Production deployment from version tags and staging from main ([#90](https://github.com/daberni/ufer/issues/90)).
- Physical-device flows, NAS operation and multi-customer isolation remain separate acceptance work.
