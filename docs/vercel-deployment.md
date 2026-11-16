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
| CRON_SECRET | Authentication for the daily scheduled sync |
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

Vercel builds only `main` (production) from Git: `git.deploymentEnabled` in `vercel.json` disables Git deployments for every other branch, so pushes create no deployments and use none of the daily allowance. A pull request gets a preview on demand: a maintainer adds the `preview` label, and the [preview workflow](../.github/workflows/preview.yml) deploys the pull request's head commit with the Vercel CLI, then again on every push while the label stays, and keeps one comment with the current preview URL. Removing the label stops further previews. The workflow uses the `VERCEL_TOKEN` repository secret, a Vercel access token scoped to the team, and the `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` repository variables; pull requests from forks never receive it and are not deployed, and neither are pushes by Dependabot; remove and re-add the label to deploy a Dependabot update. Renew the token before it expires and replace the secret with `gh secret set VERCEL_TOKEN`.

## Preview demo data

Preview deployments share one persistent Turso preview database. Fill it with the synthetic [demo dataset](setup.md#demo-data) from an operator machine; nothing seeds it automatically at build or startup. Re-run the same command when the history should end today again; it replaces only the demo rows and keeps users, sandbox bank connections and their transactions.

1. Obtain the preview database URL and token without writing them into the checkout, for example with `vercel env pull --environment=preview <file outside the repository>`: the Turso integration's TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are readable there, while the sensitive DATABASE_URL and DATABASE_AUTH_TOKEN are not. Use them as `DATABASE_URL` and `DATABASE_AUTH_TOKEN` together with `ENABLE_BANKING_ENVIRONMENT=SANDBOX`.
2. Export these values in the shell; exported variables take precedence over local `.env*` files. Confirm that `DATABASE_URL` names the preview database, not production.
3. Run `npm run demo:seed -- --confirm` from a checkout of the reviewed source. The command prints the date range and the number of demo accounts, transactions, uncategorized rows and rules.
4. Delete the pulled environment file and unset the variables.

The guard refuses databases with non-sandbox banking data or transactions on manual or CSV accounts the seed did not create. Reviewer-created manual accounts with imported transactions therefore block a later run until those rows are removed. Never run the seed against the production database.

## Initialization and deployment

1. Link the local checkout to the intended Vercel project. The generated `.vercel/` metadata stays ignored. If the CLI offers to download environment values into the checkout, decline; remove only tool-generated local tokens that were not part of the app configuration.
2. Configure the persistent database and required secrets. Initialize a new, empty database once using the reviewed baseline before concurrent web traffic. Upgrades of existing databases require the separate [migration workflow](database-migrations.md).
3. Deploy the reviewed source with `vercel deploy --prod`. A deployment request does not grant permission to commit or push unrelated changes. `.vercelignore` excludes local environment files, private keys, databases, build output and artifacts from uploads.
4. Verify the HTTPS origin, session-cookie attributes, login/logout, protected API responses, persisted data across deployments and server-only error handling. Check bank authorization and callback registration separately before claiming bank synchronization acceptance.
5. Inspect the scheduled trigger and exercise its authenticated endpoint. The configured cron runs daily at 05:00 UTC; that is 06:00 Vienna in winter and 07:00 in summer. An endpoint check does not prove a future unattended scheduled run.

The current source uses Better Auth username/password identities and active membership of one installation workspace. Before deploying it to an existing installation, separately approve and follow the [authentication migration and enrollment workflow](user-management.md#migration-and-rollout). The hosted installation completed that rollout. This version is not a multi-customer service.

## Verification status

Verified on 2026-11-15: Vercel production is Ready on Node 26 with functions in Frankfurt and the approved Turso Starter database initialized from the existing baseline. Login/logout, Secure/HttpOnly/SameSite session attributes, origin rejection, protected Problem Details responses and remote persistence passed. Both hosted and local bank callbacks are registered. A Mock ASPSP sandbox connection contains one account and two test transactions; a repeat sync inserted zero additional transactions.

Verified on 2026-11-16: the shared preview database holds the demo dataset and a Mock ASPSP sandbox connection authorized from a local instance; a manual sync from a preview deployment succeeded.

Vercel records an enabled daily 05:00 UTC cron definition, and its bearer-protected endpoint completed an authenticated sync. The first future unattended scheduled invocation has not been observed. No local financial data was imported. Real-bank coverage, physical-device flows, NAS operation, backup restoration and multi-customer isolation remain separate acceptance work.

The production project is connected to the private repository's main branch. Approved pushes to that branch trigger deployment of the matching runtime and deployment configuration.

Verified on 2026-11-16: production runs the current source with username/password identities; the obsolete APP_PASSWORD and SESSION_SECRET variables are removed. Sandbox data and test users were deleted before the switch, and one owner account was enrolled. ENABLE_BANKING_ENVIRONMENT is PRODUCTION with a production Enable Banking application in restricted mode; its private key is stored as a sensitive Production variable and in the operator password manager. The privacy and terms pages show the configured operator and data processors. Two production institutions are connected and their first sync succeeded; the unattended daily sync, repeat syncs and reauthorization with production banks have not been observed yet.
