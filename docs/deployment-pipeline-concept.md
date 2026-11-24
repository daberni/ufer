# Deployment pipeline and backup concept

Status: **proposal**, nothing here is implemented. It covers [#84](https://github.com/daberni/ufer/issues/84) (automated backups and an exercised restore) and [#90](https://github.com/daberni/ufer/issues/90) (production from version tags, staging from `main`), and turns #90 into a deployment that applies pending migrations through GitHub Actions instead of by hand. Decisions the owner must make are collected at the end.

## Current state

- Vercel's Git integration deploys every push to `main` to production (`vercel.json` enables Git deployments for `main` only). Pull-request previews run through `.github/workflows/preview.yml` on the `preview` label against one shared preview Turso database.
- The application verifies the applied migration history at startup and refuses to start with pending changesets (only an empty database is initialized automatically). This is the right safety property and stays.
- Production migrations are applied by the operator: backup → rehearsal on a copy → `npm run db:migrate` against Turso → merge. A merge before the migration produces a production build that refuses to start; a migration long before the merge runs the old build against a newer schema.
- `npm run db:verify-backup` verifies an offline SQLite artifact (integrity, foreign keys, migration identities, table counts, optional bank-secret decryption). No automated export exists and no restore of hosted data has been exercised.

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
| Free | 1 day | Too short: a problem noticed after a weekend is unrecoverable from PITR |
| Developer (≈ USD 5/month) | 10 days | **Recommended.** Covers "noticed a week later", plus enough databases for production, staging, preview and drill copies |
| Scaler and above | 30+ days | Not needed for one household |

The docs currently name the plan "Starter"; the first step is to confirm the actual plan and its window in the Turso dashboard. Recommendation: Developer plan, because the independent exports below cover longer history and provider loss, while PITR covers the common short-term case. This is a paid change and needs the owner's approval (`docs/vercel-deployment.md` forbids unapproved paid upgrades).

### Independent exports

PITR does not protect against losing the Turso account, a provider incident or a deleted database. Add a daily export to storage that Turso does not control.

- **Job:** a scheduled GitHub Actions workflow (`backup.yml`, daily at about 03:00 UTC, before the 05:00 sync cron, plus `workflow_dispatch`). GitHub Actions is preferred over a Vercel cron because a function has short time limits, no durable disk and would need storage credentials in the app's runtime. The export uses the Turso CLI (`turso db export`, which produces a consistent SQLite file of the primary) or, if that is unavailable for the plan, a libSQL `.dump` imported into a fresh SQLite file; either way the result is a self-contained SQLite file with no WAL sibling, which is what the verifier expects.
- **Verify before upload:** run `npm run db:verify-backup -- --file=… --check-bank-secrets` from the commit currently deployed in production (its migration history must match). A failed verification fails the job and nothing is uploaded under the "good" prefix.
- **Encryption:** encrypt client-side with [age](https://age-encryption.org) to a public key stored as a repository variable; the private key lives only in the owner's password manager (and a printed offline copy). The pipeline can write backups but never read them, so a leaked GitHub secret cannot decrypt history. The storage provider only sees ciphertext.
- **Storage:** an S3-compatible bucket in the EU at a provider other than Turso and Vercel, for example Cloudflare R2 (EU jurisdiction), Backblaze B2 (EU region) or Hetzner Object Storage. Use a bucket-scoped key that can only put objects (no delete, no list where the provider allows), and enable object lock / versioning so the key cannot destroy existing backups. Expected cost at this size (a few MB per export): free tier or cents per month.
- **Retention:** 14 daily, 8 weekly, 12 monthly via lifecycle rules on prefixes (`daily/`, `weekly/`, `monthly/`), i.e. at most one year. The privacy notice already has to name a retention; one year after deletion of an account the data is gone from backups. The owner decides the exact numbers; they go into `DATA_PROCESSORS` together with the provider and region.
- **Manifest:** each upload has a JSON manifest next to it: creation time, deployed commit, migration count and last changeset name, SHA-256 of the plaintext and of the ciphertext, table row counts. No account names, amounts or secrets.
- **Never in GitHub:** the repository is public, so job summaries, logs and artifacts are world-readable. The backup file, its decrypted form and row-level data must never be written to the summary, a log or an `upload-artifact`. Only counts and checksums are printed.

### Secrets layout for the backup job

| Secret / variable | Scope | Holds |
| --- | --- | --- |
| `TURSO_API_TOKEN` (secret) | GitHub environment `backup` | Turso platform token limited to the organization, used for export and drill copies |
| `PRODUCTION_DATABASE_URL`, `PRODUCTION_DATABASE_AUTH_TOKEN` (secrets) | `backup`, `production` | Read path for export; the migration job in `production` uses the same values |
| `BACKUP_S3_*` (secrets) | `backup` | Write-only bucket credentials |
| `BACKUP_AGE_RECIPIENT` (variable) | repository | age public key |
| `DATA_ENCRYPTION_KEY` (secret) | `backup` | Needed only for `--check-bank-secrets`; optional, see decisions |

GitHub environments limit which workflows and branches can read a secret (deployment branch/tag rules), which keeps production credentials away from pull-request workflows.

### Restore drill

- **Monthly automated drill** (`restore-drill.yml`): download the latest backup, decrypt it with a drill-only age identity (a second recipient the export also encrypts to, stored as a `restore-drill` environment secret), verify it, import it into a fresh SQLite file, start the app locally in the runner (`npm run build && npm start` with `ENABLE_BANKING_ENVIRONMENT` disabled for outbound calls and the scheduler off) and run a smoke test: startup with migration verification, the health endpoint and row counts against the manifest. Signing in would need a real user's credentials, so that check stays in the manual restore below. The decrypted file only exists on the ephemeral runner.
  - Trade-off: a drill identity in GitHub can decrypt backups. Alternative: run the drill monthly on the owner's machine with the offline key. The first option proves the restore is exercised without a human; the second keeps decryption entirely offline. Owner decision.
- **One manual, recorded restore** of production into a new Turso database (PITR and from an export) with real sign-in and one controlled sandbox-free check, as #84 requires. Recorded in a private recovery log, with only the result summarized in `docs/backup-and-restore.md`.
- **Recovery runbook** in `docs/backup-and-restore.md`: PITR into a new database → verify → switch `DATABASE_URL`/`DATABASE_AUTH_TOKEN` in Vercel production → redeploy the matching commit; or the same from an export via `turso db create --from-file`.

### Monitoring

- A failed scheduled workflow notifies the repository owner by GitHub email by default; keep that enabled and additionally open (or update) a single issue labeled `ops-alert` from the failing job, so a failure stays visible.
- Dead-man check: the drill also fails when the newest daily backup is older than 36 hours, which catches a silently disabled schedule (GitHub disables scheduled workflows after 60 days without repository activity).
- Optional: a free heartbeat service (for example healthchecks.io) pinged on success, which alerts when the ping is missing. It is one more processor, but it receives no data.

## 2. Deployment pipeline (#90)

### Triggers and environments

| Trigger | Target | Database | Approval |
| --- | --- | --- | --- |
| Pull request with `preview` label | Preview URL (unchanged) | Shared preview database | None |
| Push to `main` | Staging alias (e.g. `ufer-staging.vercel.app`) | Staging database (new) | None |
| Push of tag `X.Y.Z` | Production domain | Production database | Only when changesets are pending |

Tags follow #90: plain version, equal to `package.json`, pointing at a commit on `main`. Alternative considered: keep "production from `main`" and only add the migration gate. Simpler, but every merge is a release and approved PRs cannot accumulate on staging first; tags also give a clear rollback target and match the existing changelog/release practice. Recommendation: tags.

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

The app refuses to start when the database has pending changesets, but an **old** build does start against a **newer** schema if the changeset only adds things. The window between migrate (7) and promote (8) is short (seconds to a minute), so:

- **Additive changesets** (new tables, nullable columns, indexes, data backfills): migrate → promote is safe; the old build runs briefly against the new schema.
- **Breaking changesets** (drop/rename columns, tighter constraints the old build violates): use expand/contract across two releases, or mark the changeset breaking (a `-- ufer:breaking` header the plan step detects) so the pipeline puts the app in maintenance during the window. A maintenance mode does not exist yet; until it does, breaking changesets must be split. This is a review rule in `docs/database-migrations.md`.
- Startup history verification stays as the last line of defense: a build never runs against a database missing its changesets.

### Rollback and recovery

- **Code only (no changeset in the release):** Vercel instant rollback to the previous production deployment, or re-run the pipeline for the previous tag. No database action.
- **Release with an additive changeset:** roll back the code; the old build still works with the newer schema. Fix forward with a new changeset.
- **Bad data migration:** restore. PITR to the timestamp recorded before migrate into a new database, verify, switch Vercel's database env vars, redeploy the previous tag. Data written after the migration is lost or must be replayed; that is the accepted cost, decided per incident by the owner. Never edit applied changesets or the migration table.
- **Pipeline failure before migrate:** nothing changed; production still serves the old deployment.
- **Failure during migrate:** SQLite changesets run in a transaction per file in Drizzle's migrator; a failing file rolls back, earlier files stay applied. The old build may refuse to start only after a restart if it was relying on the old schema, so the failing run must be followed by either fix-forward or restore. The summary prints which files were applied.

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

Both work. A keeps credentials and approval separate (the approval environment holds no secrets, so approving cannot accidentally widen secret access) and the run graph shows clearly whether a gate was needed. B needs the same secrets duplicated in both environments.

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
| Turso Developer plan (recommended for the 10-day PITR and more databases) | ≈ USD 5/month |
| Object storage for backups | Free tier to < EUR 1/month |
| GitHub Actions minutes | Free for public repositories |
| Vercel | Hobby stays sufficient; staging deployments count against the daily deployment limit (one per merge) |

## 5. Rollout plan

Each step is issue-sized and independently reviewable. "Owner" marks steps that need the owner's explicit authorization or action.

1. **Decide and configure Turso plan** (#84). Confirm current plan and PITR window; upgrade to Developer if approved. *Owner: paid change, provider settings.*
2. **Backup storage and keys** (#84). Create bucket, write-only key, lifecycle rules, age key pair; store private key offline. *Owner: new cloud resource and account.*
3. **Backup workflow** (#84). `backup.yml` with export, verify, encrypt, upload, manifest, failure issue; GitHub environment `backup`. First run on `workflow_dispatch`. *Owner: GitHub environment/secrets creation, first run reads production.*
4. **Privacy and processors update** (#84). `DATA_PROCESSORS`, privacy notice retention, docs. Code/docs PR only.
5. **Restore drill and recorded manual restore** (#84). `restore-drill.yml`, runbook update, one recorded PITR and export restore into a fresh database. *Owner: reading production into a copy.*
6. **`db:status --json` and breaking-changeset marker**. Small change to `scripts/migrate.ts` and docs, with tests. Ordinary PR.
7. **Staging environment** (#90). Staging Turso database seeded with demo data, Vercel staging alias and env, `staging.yml` (build → migrate → deploy → alias). *Owner: new database, Vercel env, GitHub environment.*
8. **Production release workflow** (#90). `release.yml` with the job graph and conditional gate; GitHub environments `production-read`, `production-migration` (owner as reviewer), `production`. First release without pending changesets as a dry run. *Owner: environments, secrets, first tag.*
9. **Switch Vercel to workflow-only deployments** (#90). `vercel.json` `deploymentEnabled: false`, domain auto-assign setting, `docs/releasing.md` and `docs/vercel-deployment.md`. *Owner: Vercel project settings; merging changes production behavior.*
10. **First gated migration release.** A release with a pending changeset goes through the gate end to end; record the result. *Owner: approval of that migration (this is the normal per-release authorization the gate provides).*

Steps 1–5 deliver #84 and are prerequisites for 8–10. Step 6 and 7 can run in parallel with 3–5.

## Decisions for the owner

1. Turso plan: upgrade to Developer for 10-day PITR (≈ USD 5/month), or stay and rely on exports.
2. Backup storage provider and region (R2 EU, B2 EU or Hetzner), and retention (proposed 14 daily / 8 weekly / 12 monthly).
3. Restore drill: automated monthly in GitHub with a drill-only decryption key, or manual on the owner's machine with the offline key.
4. Whether the backup job may hold `DATA_ENCRYPTION_KEY` to verify bank-secret readability, or skip that check in automation.
5. Production from version tags (recommended) or keep production from `main` with only the migration gate.
6. Gate mechanism: separate skipped gate job (recommended) or expression-selected environment.
7. Standing authorization: whether approving the gate in the workflow counts as the explicit migration authorization `AGENTS.md` requires for each production migration (proposed: yes, the approval is the authorization; the summary shows the exact SQL).
