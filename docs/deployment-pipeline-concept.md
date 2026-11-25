# Deployment pipeline and backup concept

Status: **accepted concept**, implemented step by step; see the [rollout checklist](#5-rollout-plan). It covers [#84](https://github.com/daberni/ufer/issues/84) (automated backups and an exercised restore) and [#90](https://github.com/daberni/ufer/issues/90) (production from version tags, staging from `main`), and turns #90 into a deployment that applies pending migrations through GitHub Actions instead of by hand. Decisions the owner must make are collected at the end.

## Current state

- Vercel's Git integration deploys every push to `main` to production (`vercel.json` enables Git deployments for `main` only). Pull-request previews run through `.github/workflows/preview.yml` on the `preview` label against one shared preview Turso database.
- The application verifies the applied migration history at startup and refuses to start with pending changesets (only an empty database is initialized automatically). This is the right safety property and stays.
- Production migrations are applied by the operator: backup → rehearsal on a copy → `npm run db:migrate` against Turso → merge. A merge before the migration produces a production build that refuses to start; a migration long before the merge runs the old build against a newer schema.
- `npm run db:verify-backup` verifies an offline SQLite artifact (integrity, foreign keys, migration identities, table counts, optional bank-secret decryption). The nightly backup workflow below is implemented and its first run on 2026-11-25 was decrypted and verified locally, including bank-session decryption; a point-in-time restore has not been exercised yet.

## Goals and non-goals

- One release action (pushing a version tag) produces a production deployment of exactly that commit, with any pending migration backed up, rehearsed, applied and recorded in the run, and an approval only when the database changes.
- Every push to `main` is deployed to a staging alias against a staging database, migrated the same way without approval.
- Daily encrypted exports outside Turso, a monthly automated restore drill and alerts on failure.
- Non-goals: zero-downtime expand/contract tooling, automatic down-migrations, multi-region databases, a self-hosted (Docker) pipeline. The application keeps refusing to auto-upgrade an existing database at web startup; the migration runs in a separate, serialized pipeline job, which is what `AGENTS.md` and `docs/database-migrations.md` require.

## 1. Backups (#84)

### Turso plan and point-in-time restore

Point-in-time restore (PITR) is the fastest recovery for operator mistakes and bad migrations, because it creates a new database from any moment in the window without touching exports.

| Plan | PITR window (per Turso pricing, verify before deciding) | Fit |
| --- | --- | --- |
| Free (current, decided) | 1 day | Accepted limit: nightly encrypted exports and a backup before every migration cover longer history |
| Developer (≈ USD 5/month) | 10 days | Revisit when data or users grow |
| Scaler and above | 30+ days | Not needed for one household |

Decided: no upgrade for now. The free plan's 1-day PITR is an accepted limit; recovery beyond one day uses the nightly R2 exports (up to a day of data loss) or the pre-migration backup. Confirm the actual plan in the Turso dashboard (older docs say "Starter") and revisit the upgrade when data or users grow. Because the free plan limits database count, check that production, preview, staging and the temporary rehearsal copy fit; otherwise rehearse on a local SQLite copy of the pre-migration backup instead of a Turso copy.

### Independent exports

PITR does not protect against losing the Turso account, a provider incident or a deleted database. Add a daily export to storage that Turso does not control.

- **Job (decided, implemented):** a scheduled GitHub Actions workflow (`backup.yml`, nightly at 03:17 UTC, before the 05:00 sync cron, plus `workflow_dispatch`), also called as the pipeline's backup step before every migration. GitHub Actions is preferred over a Vercel cron because a function has short time limits, no durable disk and would need storage credentials in the app's runtime. The export uses `npm run db:export`, which reads every table page by page inside one libSQL read transaction (a consistent snapshot below the server's response-size cap) and writes a new self-contained SQLite file without a WAL sibling, which is what the verifier expects. The Turso CLI is not used: its export can leave uncheckpointed frames in a separate `-wal` file.
- **Verify before upload:** run `npm run db:verify-backup -- --file=…` (without `--check-bank-secrets`; the job never holds `DATA_ENCRYPTION_KEY`) from the commit currently deployed in production (its migration history must match). A failed verification fails the job and nothing is uploaded under the "good" prefix.
- **Encryption:** encrypt client-side with [age](https://age-encryption.org) to a public key stored as a repository variable; the private key lives only in the owner's password manager (and a printed offline copy). The pipeline can write backups but never read them, so a leaked GitHub secret cannot decrypt history. The storage provider only sees ciphertext.
- **Storage (decided):** a Cloudflare R2 bucket with EU jurisdiction (no egress fees). The job gets a bucket-scoped write-only token, and versioning or bucket locks keep that token from destroying existing backups. Expected cost at this size (a few MB per export): free tier.
- **Retention (decided):** dailies for 30 days plus one monthly for 12 months, enforced by R2 lifecycle rules on prefixes (`daily/`, `monthly/`). Data from a deleted account is gone from backups after at most one year. Provider, region and retention go into `DATA_PROCESSORS` and the privacy notice.
- **Manifest:** each upload has a JSON manifest next to it: creation time, deployed commit, migration count and last changeset name, SHA-256 of the plaintext and of the ciphertext, table row counts. No account names, amounts or secrets.
- **Never in GitHub:** the repository is public, so job summaries, logs and artifacts are world-readable. The backup file, its decrypted form and row-level data must never be written to the summary, a log or an `upload-artifact`. Only counts and checksums are printed.

### Secrets layout for the backup job

| Secret / variable | Scope | Holds |
| --- | --- | --- |
| `TURSO_API_TOKEN` (secret) | GitHub environment `backup` | Turso platform token limited to the organization, used for export and drill copies |
| `PRODUCTION_DATABASE_URL`, `PRODUCTION_DATABASE_AUTH_TOKEN` (secrets) | `backup`, `production` | Read path for export; the migration job in `production` uses the same values |
| `BACKUP_S3_*` (secrets) | `backup` | Write-only bucket credentials |
| `BACKUP_AGE_RECIPIENT` (variable) | repository | age public key |

`DATA_ENCRYPTION_KEY` is deliberately not in GitHub; bank-secret decryption is checked in the local drill.

GitHub environments limit which workflows and branches can read a secret (deployment branch/tag rules), which keeps production credentials away from pull-request workflows.

### Restore drill

- **Manual local drill (decided):** on the owner's machine, download a backup, decrypt it with the offline age key, run `npm run db:verify-backup -- --file=… --check-bank-secrets` with `DATA_ENCRYPTION_KEY` from the password manager, and start the app against the restored SQLite file on 127.0.0.1 with the scheduler and outbound bank calls off; verify sign-in, representative views and row counts against the manifest. Decryption keys never enter GitHub. Record each drill (date, backup, commit, result) in a private recovery log and summarize only the result in `docs/backup-and-restore.md`. Cadence (decided): once after setup, then quarterly.
- **PITR exercise:** once, restore production by PITR into a new Turso database and verify it the same way, as #84 requires; then delete the copy.
- **Recovery runbook** in `docs/backup-and-restore.md`: PITR into a new database → verify → switch `DATABASE_URL`/`DATABASE_AUTH_TOKEN` in Vercel production → redeploy the matching commit; or the same from an export via `turso db create --from-file`.

### Monitoring

- A failed scheduled workflow notifies the repository owner by GitHub email by default; keep that enabled and additionally open (or update) a single issue labeled `ops-alert` from the failing job, so a failure stays visible.
- Dead-man check: a small scheduled check (part of `backup.yml` or a separate cron) fails when the newest daily object in R2 is older than 36 hours, which catches a silently disabled schedule (GitHub disables scheduled workflows after 60 days without repository activity).
- Optional: a free heartbeat service (for example healthchecks.io) pinged on success, which alerts when the ping is missing. It is one more processor, but it receives no data.

## 2. Deployment pipeline (#90)

### Triggers and environments

| Trigger | Target | Database | Approval |
| --- | --- | --- | --- |
| Pull request with `preview` label | Preview URL (unchanged) | Shared preview database | None |
| Push to `main` | Staging alias (e.g. `ufer-staging.vercel.app`) | Staging database (new) | None |
| Push of tag `X.Y.Z` | Production domain | Production database | Only when changesets are pending |

Tags follow #90: plain version, equal to `package.json`, pointing at a commit on `main`. Decided: production from tags. (Considered alternative: keep production from `main` and add only the migration gate; rejected because every merge would be a release and staging could not collect changes first.)

### Building the exact commit

Deploy with `vercel build --prod` + `vercel deploy --prebuilt --prod` (or `vercel deploy --prod` from a checkout of the tag SHA) in the workflow, with Vercel Git deployments disabled for all branches (`"git": {"deploymentEnabled": false}`). The build runs from `actions/checkout` of `github.sha`, and the deployment carries `--meta githubCommitSha=…` and `--meta releaseTag=…`. The pipeline later promotes this same deployment rather than rebuilding.

### Production job graph

```
verify ─► plan ─► gate (environment chosen by plan) ─► backup ─► rehearse ─► build (no promote) ─► migrate ─► promote ─► smoke
```

1. **verify**: tag format, tag == `package.json` version, `git merge-base --is-ancestor $SHA origin/main`, CI already green for the SHA (or rerun lint/type/tests/build).
2. **plan**: connect read-only to the production database and compute pending changesets. Add `npm run db:status -- --json` (small change to `scripts/migrate.ts`) that prints applied/pending changeset names and fails on changed history. Output `pending=true|false` and write the job summary: a table of pending files and each file's SQL in a collapsed `<details>` block, like timr's "Pending database update SQL". The SQL is already public in the repository, so publishing it in a public summary leaks nothing.
3. **gate**: approval only when `pending == 'true'` (section 3).
4. **backup**: run the backup workflow as a reusable workflow (`workflow_call`) with a `pre-migration/` prefix and a manifest that names the tag; verify it as above. Also record the current PITR timestamp in the summary as the fallback restore point.
5. **rehearse**: create a throwaway Turso database from the backup (or PITR branch) named `ufer-rehearsal-<run id>`, run `npm run db:migrate` against it, then `db:verify-backup` on an export of the result and a startup smoke test of the new build against it. Destroy it at the end (`if: always()`).
6. **build**: `vercel deploy --prebuilt` *without* promoting (`--prod --skip-domain`), so a production-environment deployment exists but the domain still serves the old one.
7. **migrate**: `npm run db:migrate` against production, guarded by a `concurrency: production-db` group so it never runs twice. The daily cron's job lease already protects shared financial state; the migration step acquires the same named lease (or pauses the cron by running outside its 05:00 slot) so no sync writes during the migration.
8. **promote**: `vercel promote <deployment>`, which switches the domain atomically.
9. **smoke**: health check and unauthenticated checks against the production URL; on failure the job fails loudly with the recovery instructions in the summary (no automatic rollback of the database).

Without pending changesets the run is verify → plan → build → promote → smoke, with the backup step optional (recommended anyway as a cheap pre-release snapshot).

### Ordering and compatibility

Startup verification rejects any migration history the build does not know: an **old** build refuses to start once the database contains a changeset row it does not have, even if the SQL was purely additive. Instances that are already warm keep serving because verification runs when an instance initializes its database connection, but any cold start of the old deployment between migrate (7) and promote (8) fails. Therefore:

- Keep the migrate → promote window as short as possible: promote immediately after a successful migrate, with no other steps in between, and stay clear of the 05:00 cron slot. Requests that hit a cold start in that window fail with the existing "database is newer" error; for a single-household app this brief window is accepted.
- **Breaking changesets** (drop/rename columns, tighter constraints the new build relies on but the old data violates): split them into expand/contract releases. A maintenance mode does not exist; if a future changeset cannot be split, add one before shipping it. This is a review rule in `docs/database-migrations.md`.
- Startup history verification stays as the last line of defense: a build never runs against a database missing its changesets or carrying changesets it does not know.

Making old builds tolerate newer additive history (for example by marking changesets backward compatible) would remove the window and allow code rollback after a migration, but it weakens the history check and is not part of this plan.

### Rollback and recovery

- **Code only (no changeset in the release):** Vercel instant rollback to the previous production deployment, or re-run the pipeline for the previous tag. No database action.
- **Release with a changeset:** a code rollback is not possible after the migration, because the previous build refuses the newer history. Fix forward with a new release, or restore (next point) and redeploy the previous tag.
- **Bad data migration:** restore. PITR to the timestamp recorded before migrate (within the plan's window) or the pre-migration backup into a new database, verify, switch Vercel's database env vars, redeploy the previous tag. Data written after the migration is lost or must be replayed; that is the accepted cost, decided per incident by the owner. Never edit applied changesets or the migration table.
- **Pipeline failure before migrate:** nothing changed; production still serves the old deployment.
- **Failure during migrate:** SQLite changesets run in a transaction per file in Drizzle's migrator; a failing file rolls back, earlier files stay applied. If any file was applied, the old build can no longer cold-start, so the failing run must be followed promptly by fix-forward or restore. The summary prints which files were applied.
## 3. Conditional approval

### Can GitHub require approval only when migrations are pending?

Yes. Approval in GitHub Actions is a property of an **environment** with "required reviewers". A job pauses for approval when it references such an environment, and a job that is **skipped** never asks. Two equivalent mechanisms:

**A. A separate gate job that is skipped when nothing is pending (recommended).**

```yaml
jobs:
  plan:
    runs-on: ubuntu-latest
    environment: production-read      # holds read-only DB credentials, no reviewers
    outputs:
      pending: ${{ steps.status.outputs.pending }}
    steps:
      - uses: actions/checkout@v7
        with: { ref: ${{ github.sha }}, persist-credentials: false }
      - uses: actions/setup-node@v7
        with: { node-version-file: .nvmrc }
      - run: npm ci
      - id: status
        env:
          DATABASE_URL: ${{ secrets.DATABASE_URL }}
          DATABASE_AUTH_TOKEN: ${{ secrets.DATABASE_AUTH_TOKEN }}
        run: |
          npm run --silent db:status -- --json > status.json
          pending=$(jq -r '.pending | length > 0' status.json)
          echo "pending=$pending" >> "$GITHUB_OUTPUT"
          {
            echo "## Pending database changesets"
            if [ "$pending" = "true" ]; then
              jq -r '.pending[] | "- `\(.)`"' status.json
              for f in $(jq -r '.pending[]' status.json); do
                printf '\n<details><summary>%s</summary>\n\n```sql\n' "$f"
                cat "drizzle/sqlite/$f.sql"
                printf '\n```\n</details>\n'
              done
            else
              echo "None. Deploying without approval."
            fi
          } >> "$GITHUB_STEP_SUMMARY"

  approve-migration:
    needs: plan
    if: needs.plan.outputs.pending == 'true'
    runs-on: ubuntu-latest
    environment: production-migration   # required reviewer: the owner
    steps:
      - run: echo "Migration approved for ${{ github.ref_name }}"

  migrate-and-deploy:
    needs: [plan, approve-migration]
    # Runs after approval, or directly when the gate was skipped.
    if: ${{ !cancelled() && !failure() && (needs.approve-migration.result == 'success' || needs.approve-migration.result == 'skipped') }}
    runs-on: ubuntu-latest
    environment: production            # deploy credentials, no reviewers
    concurrency: { group: production-db, cancel-in-progress: false }
    steps:
      - run: echo "backup → rehearse → build → migrate → promote → smoke"
```

**B. One job whose environment is chosen by expression.**

```yaml
  deploy:
    needs: plan
    environment: ${{ needs.plan.outputs.pending == 'true' && 'production-migration' || 'production' }}
```

Decided: variant A. It keeps credentials and approval separate (the approval environment holds no secrets) and the run graph shows whether a gate was needed. B would need the same secrets duplicated in both environments.

A time-of-check/time-of-use guard is required in either variant: between plan and migrate someone could run another migration. The migrate step re-reads the pending list and fails if it differs from the approved plan (pass the plan's list as an output and compare).

### Limitations

- **Plan availability:** environment required reviewers are free for **public** repositories; for private repositories they need GitHub Team/Pro or above. `daberni/ufer` is public today; making it private on a free plan would silently drop the gate (the job would run without approval). The pipeline should fail closed: the plan step can check via API that the `production-migration` environment has a protection rule and abort otherwise.
- **Who approves:** up to six users/teams; with "prevent self-review" off, the owner can approve their own tag push, which is the intended single-maintainer setup.
- **Timeout:** a waiting job expires after 30 days; the run then fails and the tag must be re-run (`gh run rerun`). Nothing is changed while waiting because backup/rehearse/migrate come after the gate. Optionally add a wait timer.
- **Public summaries:** job summaries of a public repository are public. They contain only changeset names and SQL already in the repository, never data or connection strings.
- **Secrets of environments with deployment rules:** restrict `production*` environments to tags matching `[0-9]*.[0-9]*.[0-9]*` and `staging` to `main`, so a pull request workflow cannot read them.

### Comparison with timr

timr's `deploy.yml` checks Liquibase status, writes the pending update SQL into the job summary in a `<details>` block, uploads `update.sql` as an artifact and then **fails** the deployment when changesets are pending: applying them stays a manual operator step and the deployment is re-run afterwards.

Taken over: status check before deployment, SQL in a collapsible summary section, a precise pending/up-to-date/unknown tri-state that fails on "unknown".

Different for Ufer: instead of failing, the pipeline pauses at an approval and then performs backup, rehearsal and migration itself. This is acceptable here because the database is small (a full backup and rehearsal take seconds), there is a single operator who is also the approver, and the steps that timr's operators do by hand are scripted and verified. The `update.sql` artifact is not needed because the changesets are plain files in the repository; artifacts in a public repository should be avoided anyway.

## 4. Staging, preview and secrets layout

### Databases

| Database | Used by | Data | Migrated by |
| --- | --- | --- | --- |
| `production` | Production deployments | Real | Tag pipeline after approval |
| `staging` (new) | Staging alias from `main` | Synthetic demo data, sandbox bank | Staging pipeline, automatically |
| `preview` (existing) | Labeled PR previews | Synthetic demo data | Unchanged: one-off, operator-run, because PRs carry unmerged changesets |
| `ufer-rehearsal-*`, `ufer-drill-*` | Pipeline, temporary | Copies of production | Created and destroyed per run |

Staging migrates automatically because it holds synthetic data only; it runs every merged changeset before any production tag, which is an additional rehearsal on a long-lived database. The preview database keeps its current manual process: automatically applying unmerged changesets from a PR would make it incompatible with other PRs.

Rehearsal and drill copies contain production data in Turso's region; they are deleted at the end of each run and are covered by the existing Turso processor entry.

### Secrets: GitHub environments vs Vercel

- **Vercel environment variables** stay the source for the running application (production, preview, and a new staging custom environment or the Preview environment with branch-specific values for the staging alias, including `APP_URL`).
- **GitHub environments** hold only what the pipeline needs: `VERCEL_TOKEN` (deploy), database URL/token per database for status/migrate, `TURSO_API_TOKEN` for creating copies, backup bucket credentials. The pipeline does not need `BETTER_AUTH_SECRET`, bank keys or `DATA_ENCRYPTION_KEY`, except the backup verification of bank secrets (optional).
- Duplicating the production database token in GitHub is the main new exposure. Mitigate with a dedicated Turso token for the pipeline (separately revocable), environment branch/tag rules, and no `pull_request_target` workflows.

| Environment | Reviewers | Branch/tag rule | Secrets |
| --- | --- | --- | --- |
| `staging` | none | `main` | staging DB, `VERCEL_TOKEN` |
| `production-read` | none | version tags, schedule | production DB (read for status) |
| `production-migration` | owner | version tags | none |
| `production` | none | version tags | production DB, `VERCEL_TOKEN`, `TURSO_API_TOKEN` |
| `backup` | none | `main` (schedule runs on default branch) | production DB, `TURSO_API_TOKEN`, bucket write key |

### Vercel settings to change

- `vercel.json`: `"git": {"deploymentEnabled": false}` so Git pushes no longer deploy; all deployments come from workflows (previews already do).
- Optionally disable "Auto-assign custom production domains" so a `--prod` build does not take the domain before the pipeline promotes it (the alternative is `--skip-domain` per deploy).
- Assign the staging alias to the latest `main` deployment from the staging workflow (`vercel alias set`).
- The existing cron (`/api/cron`, 05:00 UTC) runs on production only; the pipeline avoids that slot or takes the job lease.

### Costs

| Item | Cost |
| --- | --- |
| Turso | Free plan, no change (Developer ≈ USD 5/month if revisited) |
| Cloudflare R2 for backups | Free tier (10 GB, no egress fees); needs a payment method on the account |
| GitHub Actions minutes | Free for public repositories |
| Vercel | Hobby stays sufficient; staging deployments count against the daily deployment limit (one per merge) |

## 5. Rollout plan

The steps are worked through interactively under #84 and #90; this checklist tracks them. "Owner" marks steps that need the owner's action or authorization.

- [x] Nightly encrypted backup workflow, freshness alert and owner setup docs (`backup.yml`, `backup-freshness.yml`, `db:export`)
- [ ] Owner: confirm the Turso plan, its restore window and database limit; no upgrade
- [ ] Owner: Cloudflare account with payment method, R2 EU bucket, lifecycle and lock rules, token, age key pair, GitHub `backup` environment; first manual backup run and local decryption check
- [ ] Backup location and retention in `DATA_PROCESSORS` and the privacy notice (owner updates the production value in Vercel)
- [ ] Restore runbook, first local drill and one point-in-time restore into a fresh database (owner authorization)
- [ ] `db:status --json` and the breaking-changeset marker
- [ ] Staging from `main` with automatic migrations (owner: staging database, Vercel env, GitHub environment)
- [ ] Tag release workflow with the conditional migration gate, reusing the backup workflow (owner: GitHub environments and secrets); switch the nightly backup's ref to the latest tag
- [ ] Workflow-only Vercel deployments (owner: Vercel settings; merging changes production behavior)
- [ ] First gated migration release (owner: approval)
- [ ] `AGENTS.md`: gate approval is the migration authorization, with the proposed wording: "For production, approving the `production-migration` gate of a release run is the explicit authorization for exactly the changesets listed in that run's summary; it does not cover other databases, re-runs with a different pending list or manual migrations." (owner review)

The backup steps deliver #84 and come before the release workflow.

## Decided

- Backups run in GitHub Actions: nightly cron plus a backup before every migration.
- Storage: Cloudflare R2, EU jurisdiction bucket, write-only token, lifecycle retention. Free at this size (10 GB storage and the operation quota in the free tier, no egress fees); R2 requires a payment method on the Cloudflare account.
- Retention: dailies for 30 days, one monthly for 12 months.
- Restore drill: manual and local, once after setup and then quarterly; `DATA_ENCRYPTION_KEY` stays out of GitHub, CI verifies without `--check-bank-secrets`.
- Turso: stay on the free plan; 1-day PITR is an accepted limit, revisit when data or users grow.
- Production deploys from version tags, staging from `main`.
- Gate mechanism: a separate gate job in a protected environment, skipped when nothing is pending.
- Approving the gate is the explicit per-migration authorization `AGENTS.md` requires, limited to the changesets shown in that run's summary. The `AGENTS.md` wording change is rollout step 11.

## Open points

- None for the concept. Implementation steps marked *Owner* need authorization when they start.
