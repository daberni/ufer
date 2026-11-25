# Releasing

Production deploys only from version tags; every push to `main` deploys to staging. Both are GitHub Actions workflows; Vercel's Git integration deploys nothing (`git.deploymentEnabled: false` in `vercel.json`). The design and its trade-offs are in the [deployment pipeline concept](deployment-pipeline-concept.md).

## Staging

[`staging.yml`](../.github/workflows/staging.yml) runs on every push to `main`:

1. Lists the pending changesets of the shared preview database and their SQL in the job summary.
2. Deploys a preview build, which uses Vercel's Preview environment variables (preview database, sandbox bank), with `APP_URL` set to the staging alias.
3. Applies the pending changesets without approval (synthetic demo data and the sandbox bank only), then points the alias at the new build. A failed build changes neither the database nor the alias.

Pull requests get no hosted previews; the former label-based preview workflow was removed. Verify changes locally before merge and on staging after merge.

Until the `staging` environment is configured, the workflow finishes with a warning.

## Production release

1. Bump `version` in `package.json`, add the changelog entry and merge to `main`. Check the change on staging.
2. Tag the merged commit with the plain version and push the tag: `git tag 0.4.0 <commit>` and `git push origin refs/tags/0.4.0`.
3. [`release.yml`](../.github/workflows/release.yml) then:
   - **verify:** checks that the tag equals the `package.json` version and points to a commit on `main`, that the `production-migration` environment requires a reviewer, and runs lint, type, style, test and build checks;
   - **plan:** lists the production database's pending changesets with their SQL in the job summary;
   - **approve-migration:** only when changesets are pending, waits for approval of the `production-migration` environment. Approving is the explicit authorization for exactly the listed changesets; without pending changesets this job is skipped and nobody is asked;
   - **backup:** only when changesets are pending, runs the [backup workflow](backup-and-restore.md#nightly-encrypted-backups) with reason `pre-migration-<tag>`;
   - **deploy:** re-checks that the pending list still equals the approved one, rehearses the migration on a local copy of production (removed at the end of the job), deploys the build without the production domain, migrates, promotes the deployment to the domain and runs a smoke test (the home page answers and `/api/me` returns 401).
4. Sign in on production and check a representative view; the workflow's smoke test is unauthenticated.

Between the migration and the promotion, cold starts of the previous deployment refuse the newer migration history; the workflow keeps that window to a single step. Avoid releasing around the daily 05:00 UTC sync. Split changesets that the previous build cannot work with into expand/contract releases.

## Recovery

- **Failure before "Migrate production":** nothing changed in production; fix the cause and re-run the failed jobs or push a new tag.
- **Code-only release:** use Vercel's instant rollback to the previous production deployment, or re-run the previous tag's release.
- **Release with a changeset:** a code rollback is not possible after the migration, because the previous build refuses the newer history. Fix forward with a new release, or restore: create a new database from the pre-migration backup (or Turso's point-in-time restore within the plan's window), verify it as in [backup and restore](backup-and-restore.md), switch Vercel's production database variables and re-run the previous tag's release. Data written after the migration is lost unless replayed.
- Never edit applied changesets or the migration history to make a failed release pass.

## One-time setup

These steps need the owner's accounts. Keep identifiers and tokens out of the repository.

1. **Staging database.** Staging reuses the existing preview database; no new database is needed. Its URL and token are in the password manager ("Ufer - Vercel", section "Turso preview").
2. **GitHub environment `staging`:** deployment branch `main`, no reviewers. Secrets `DATABASE_URL`, `DATABASE_AUTH_TOKEN` (preview database) and `VERCEL_TOKEN`; variable `STAGING_ALIAS`, for example `ufer-staging.vercel.app`.
3. **GitHub environment `release`:** deployment tags matching `[0-9]*.[0-9]*.[0-9]*`, no reviewers. (The existing `Production` and `Preview` environments belong to Vercel's deployment statuses; leave them unchanged.) Secrets `DATABASE_URL`, `DATABASE_AUTH_TOKEN` (production, with write access for the migration) and `VERCEL_TOKEN`; variable `PRODUCTION_URL` (the production origin, `https://…`).
4. **GitHub environment `production-migration`:** deployment tags matching `[0-9]*.[0-9]*.[0-9]*`, **required reviewers: the owner**, self-review allowed, no secrets. The release refuses to run if this rule is missing.
5. **Backup environment.** Add a dedicated read-only production token as `DATABASE_AUTH_TOKEN` in the `backup` environment, replacing the write-capable one.
6. **Vercel.** Merging the change that sets `git.deploymentEnabled` to `false` stops automatic production deployments from `main`; complete steps 1–4 first. If the project setting "Auto-assign custom production domains" is off, nothing else changes; the workflow deploys with `--skip-domain` either way.
7. **First release.** Push a tag for a release without pending changesets to check the path without a gate, then let the next release with a changeset go through the gate.
