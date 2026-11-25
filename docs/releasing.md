# Releasing

Production deploys only from version tags; every push to `main` deploys to staging. Both are GitHub Actions workflows; Vercel's Git integration deploys nothing (`git.deploymentEnabled: false` in `vercel.json`). The design and its trade-offs are in the [deployment pipeline concept](deployment-pipeline-concept.md).

## Staging

[`staging.yml`](../.github/workflows/staging.yml) runs on every push to `main`:

1. Lists the names of the shared preview database's pending changesets in the job summary.
2. Deploys a preview build, which uses Vercel's Preview environment variables (preview database, sandbox bank), with `APP_URL` set to the staging alias.
3. Applies the pending changesets without approval (synthetic demo data and the sandbox bank only), then points the alias at the new build. A failed build changes neither the database nor the alias.

Staging runs one at a time and is never cancelled mid-migration. GitHub may start queued runs in any order, so a run first checks that its commit is still the head of `main` and otherwise skips; the newest commit's run therefore always finishes last.

Labeled pull-request previews (see [Vercel deployment](vercel-deployment.md#preview-demo-data)) use the same database. Because staging moves it to `main`'s schema, a preview starts only when its branch contains all of `main`'s changesets and adds none.

Until the `staging` environment is configured, the workflow finishes with a warning.

## Production release

1. Bump `version` in `package.json`, add the changelog entry and merge to `main`. Check the change on staging.
2. Tag the merged commit with the plain version and push the tag: `git tag 0.4.0 <commit>` and `git push origin refs/tags/0.4.0`.
3. [`release.yml`](../.github/workflows/release.yml) then:
   - **verify:** checks that the tag equals the `package.json` version, points to a commit on `main` and is the highest version tag (so a delayed run of an older tag never promotes over a newer release), that the `production-migration` environment requires a reviewer, and runs lint, type, style, test and build checks;
   - **plan** (`release` environment, read-only token): lists the names of the production database's pending changesets in the job summary; their SQL is in `drizzle/sqlite/` at the tagged commit;
   - **deploy** (`release`): deploys the build to Vercel without the production domain;
   - **migrate** (`production-migration`), only when changesets are pending: waits for the owner's approval, which is the explicit authorization for exactly the listed changesets. It then re-checks that the pending list is unchanged, takes and verifies a pre-migration backup, rehearses the migration on a local copy of production and starts the release build against it with a database-backed sign-in check (the copy is removed at the end of the job), and migrates production while holding the `sync` job lease (it waits up to 10 minutes for a running sync or import and then fails without changes). Only this job holds the production write token; without pending changesets it is skipped, nobody is asked and no write credentials are used;
   - **promote** (`release`): promotes the deployment to the production domain and runs a smoke test (the home page answers and `/api/me` returns 401).
4. Sign in on production and check a representative view; the workflow's smoke test is unauthenticated.

Between the migration and the promotion, cold starts of the previous deployment refuse the newer migration history; the workflow keeps that window to a single step. Split changesets that the previous build cannot work with into expand/contract releases.

## Recovery

- **Failure before "Migrate production":** nothing changed in production; fix the cause and re-run the failed jobs or push a new tag.
- **Code-only release:** use Vercel's instant rollback to the previous production deployment. Re-running an older tag's release fails by design; to ship older code as the current release, tag it with a new, higher version.
- **Release with a changeset:** a code rollback is not possible after the migration, because the previous build refuses the newer history. Fix forward with a new release, or restore: create a new database from the pre-migration backup (or Turso's point-in-time restore within the plan's window), verify it as in [backup and restore](backup-and-restore.md), switch Vercel's production database variables and roll back to the previous deployment with Vercel's instant rollback. Data written after the migration is lost unless replayed.
- Never edit applied changesets or the migration history to make a failed release pass.
- The pipelines only upgrade databases that already have a migration history (`managed`); they stop on a legacy or empty database, whose adoption or initialization stays a manual step under [database migrations](database-migrations.md).

## One-time setup

These steps need the owner's accounts. Keep identifiers and tokens out of the repository.

1. **Staging database.** Staging reuses the existing preview database; no new database is needed. Its URL and token are in the password manager ("Ufer - Vercel", section "Turso preview").
2. **GitHub environment `staging`:** deployment branch `main`, no reviewers. Secrets `DATABASE_URL`, `DATABASE_AUTH_TOKEN` (preview database) and `VERCEL_TOKEN`; variable `STAGING_ALIAS`, for example `ufer-staging.vercel.app`.
3. **Read-only production token.** Create a read-only token for the production database. Use it in both the `release` and the `backup` environments.
4. **GitHub environment `release`:** deployment tags matching `[0-9]*.[0-9]*.[0-9]*`, no reviewers. (The existing `Production` and `Preview` environments belong to Vercel's deployment statuses; leave them unchanged.) Secrets `DATABASE_URL`, `DATABASE_AUTH_TOKEN` (the **read-only** token) and `VERCEL_TOKEN`; variable `PRODUCTION_URL` (the production origin, `https://…`).
5. **GitHub environment `production-migration`:** deployment tags matching `[0-9]*.[0-9]*.[0-9]*`, **required reviewers: the owner**, self-review allowed. Secrets `DATABASE_URL`, `DATABASE_AUTH_TOKEN` (production token **with write access**, used only here), `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` and `R2_ENDPOINT`; variables `BACKUP_BUCKET` and `BACKUP_AGE_RECIPIENTS` (the same values as in the `backup` environment). The release refuses to run if the reviewer rule is missing.
   In the `backup` environment, replace `DATABASE_AUTH_TOKEN` with the read-only token from step 3.
6. **Vercel.** Merging the change that sets `git.deploymentEnabled` to `false` stops automatic production deployments from `main`; complete steps 1–5 first. If the project setting "Auto-assign custom production domains" is off, nothing else changes; the workflow deploys with `--skip-domain` either way.
7. **First release.** Push a tag for a release without pending changesets to check the path without a gate, then let the next release with a changeset go through the gate.
