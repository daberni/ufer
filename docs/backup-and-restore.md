# Backup and restore

The offline verifier, the synthetic recovery rehearsal and the [nightly backup workflow](#nightly-encrypted-backups) are implemented. The workflow stays inactive until the [one-time setup](#one-time-setup) is done; hosted point-in-time recovery and a restore of real hosted data are not verified yet. Track the remaining operations in [#84](https://github.com/daberni/ufer/issues/84).

## What a recovery needs

Keep a consistent database artifact, the matching application revision and reviewed migration files, and the corresponding secret versions. In particular, bank-session ciphertext needs its matching `DATA_ENCRYPTION_KEY`; provider API access also needs the configured application ID and private key. Authentication configuration includes `BETTER_AUTH_SECRET`. Store secret material separately through the operator's secret manager, never in the database export, repository, issue or verification report.

Record the artifact's creation time, application commit, migration count, checksum and source environment in a private recovery record. Protect exports as financial and authentication data. None of these instructions authorize overwriting a database or accessing a hosted installation.

## Obtain a consistent local artifact

For a self-hosted SQLite installation, use SQLite's [backup API](https://www.sqlite.org/backup.html), its shell `.backup` command or another verified consistent-snapshot mechanism. Do not copy just a database file while writes may still be in its WAL. A raw file copy requires stopping all application/scheduler writes and preserving the complete consistent state. A SQL export must be imported into a new, empty local database before using the verifier.

Use a newly created private directory for every rehearsal. The backup API and shell can overwrite an existing destination, so never select a live database or a pre-existing recovery target. The checked-in synthetic test uses Node's maintained [SQLite backup API](https://nodejs.org/api/sqlite.html) and a fresh temporary destination; it does not add a production export job.

For Turso, a local artifact must first be obtained through an explicitly authorized provider export or restore. Provider access, export acquisition, retention and point-in-time recovery are separate operations. This command does not contact Turso.

## Verify an offline artifact

Use the repository revision matching the artifact's applied migrations and Node 26, then install its locked dependencies with `npm ci`. Run:

```sh
npm run db:verify-backup -- --file=/path/to/offline-copy.sqlite
```

The file must already exist and remain quiescent throughout verification. This is an offline artifact check, not a way to certify a live data directory. Nonempty `-wal` or rollback `-journal` siblings are rejected before opening and before reporting success, including when the supplied path is a symlink. Create a self-contained SQLite API snapshot in a fresh directory instead; copying just the main file beside an active WAL can omit committed records.

The command opens the artifact read-only and checks SQLite integrity, foreign keys, exact applied migration identities/checksums and the presence/counts of the application's tables. It does not create a missing database, apply migrations, repair data, load `.env` files, use `DATABASE_URL` as a fallback or call a bank/provider. A pending, changed or newer migration history fails; select the matching application revision rather than bypassing it.

The JSON result contains migration/table counts and `bankSessionSecrets: "not_checked"`. No account names, transaction contents, password hashes or encrypted/decrypted session values are emitted. Counts help compare against a separately recorded source manifest; a self-consistent export alone cannot prove that every original record was included.

To check bank-session decryption, supply the matching `DATA_ENCRYPTION_KEY` through the operator's secure environment and opt in:

```sh
npm run db:verify-backup -- --file=/path/to/offline-copy.sqlite --check-bank-secrets
```

The command decrypts locally using Ufer's existing encryption implementation and discards the plaintext. A missing/wrong key or damaged ciphertext fails without printing a credential. A `verified` result checks cryptographic readability only; it does not prove the provider consent is still active. No key is needed when there are no stored encrypted bank sessions.

## Rehearse application recovery

1. Obtain authorization for the exact source, destination and effects. Restore to a fresh isolated target with matching application/migrations and secrets. Keep schedulers and outbound provider calls disabled while inspecting the copy.
2. Verify the offline artifact and compare recorded counts, balances, transaction identities, manual corrections and encrypted-session readability against the source manifest. Do not migrate it as an implicit verification step.
3. Start the isolated application and verify individual sign-in, workspace access and representative financial views. A restored database alone is not evidence that the application or its secrets work.
4. If an actual provider request is separately authorized, perform a controlled sync on the copy and record its effects. The local test uses a mock provider; it does not demonstrate recovery of a real bank consent.
5. Record the application/artifact identities, checks and limits without financial details or secret values. Stop the rehearsal instance and handle its data under the chosen retention policy. A hosted cutover, overwrite or cleanup of existing data remains a separate authorized action.

## Recorded synthetic verification

`tests/backup-restore.test.ts` creates a local database with an individual owner, encrypted synthetic bank session and manually corrected transaction. It writes committed data in WAL mode, takes a consistent SQLite API backup to a fresh file, and exercises recovery against that file. It verifies unchanged financial rows and manual corrections, signing in with the restored owner's credentials, workspace access, decryption with the matching key and a successful fully mocked bank sync on the restored copy. The source balance stays unchanged.

A regression fixture also demonstrates a committed account present in WAL but missing from a raw main-file copy; the verifier rejects that source and its symlink instead of reporting the WAL-assisted counts as a standalone backup. Additional cases verify rejection of missing/corrupt artifacts, broken foreign keys, altered/pending migration history and wrong encryption keys. File checksums remain unchanged during verification. The missing-key check is explicit rather than silently counted as complete recovery. These checks were exercised only with synthetic local data; they do not replace a restore trial of an actual authorized hosted export.

## Nightly encrypted backups

`.github/workflows/backup.yml` runs nightly at 03:17 UTC, before the 05:00 sync, and on manual dispatch. The release pipeline will call the same workflow before a migration with a `reason` (for example `pre-migration-0.4.0`) and the ref of the release currently in production; such a call fails instead of skipping when the setup is incomplete.

1. `npm run db:export -- --file=<new file>` copies the database named by `DATABASE_URL` into a new self-contained SQLite file. All reads run in one read transaction, so the copy is consistent while the application writes; tables are read in pages planned from measured row sizes (about 2 MB each, a single larger row on its own) to stay well below the remote server's 10 MB response limit, and integers are copied exactly. It never overwrites an existing file and never loads `.env` files.
2. `npm run db:verify-backup -- --migrations=<dir>` checks the copy against the changesets of the selected ref (the workflow's commit by default, or the `ref` input); the expected tables come from applying those changesets to an empty in-memory database. Only the first changesets up to the backup's applied count are used, so a ref with newer changesets that production has not applied yet (such as `main` after merges or a new release tag before its migration) still verifies the backup. The verifier itself always comes from the workflow's commit, so a pre-migration call can name an older release still in production. Bank-secret decryption is not checked in CI because `DATA_ENCRYPTION_KEY` stays out of GitHub; the [restore drill](#rehearse-application-recovery) checks it locally.
3. The export and the verification report (which contains row counts) are encrypted with [age](https://age-encryption.org) to the public keys in `BACKUP_AGE_RECIPIENTS`. The private key exists only in the owner's password manager and an offline copy; GitHub can write backups but never decrypt them.
4. The workflow uploads `<name>.sqlite.age`, `<name>.report.json.age` and a public `<name>.manifest.json` (creation time, commits, migration count, checksums, size) to `daily/YYYY/MM/` and, on the first of the month, to `monthly/YYYY/`. Retention comes from the bucket's lifecycle rules: 30 days for `daily/`, 365 days for `monthly/`.
5. The plaintext is deleted from the runner at the end of the job.

The repository is public, so logs, job summaries and artifacts are world-readable. The workflow prints only the object name, source commit, migration count and ciphertext checksum. Export errors are reduced to a generic message because driver errors can name the database host; secret values are additionally masked by GitHub.

`.github/workflows/backup-freshness.yml` runs at 15:41 UTC and fails when the newest daily backup is older than 36 hours or missing; this also catches a schedule GitHub disabled after 60 days without repository activity. A failed nightly or freshness run opens one issue titled "Database backup alert" with the `ops-alert` label, or comments on the open one; GitHub also emails the owner about failed scheduled runs. Close the issue once backups succeed again.

Until the setup is complete, both workflows finish with a visible warning in the run summary instead of failing. The first run creates the `backup` environment if it does not exist yet; finish its configuration as below.

## One-time setup

These steps need the owner's accounts and are tracked in [#84](https://github.com/daberni/ufer/issues/84). Keep identifiers and keys out of the repository.

1. **Encryption key.** Install age locally and run `age-keygen -o ufer-backup.key`. Store the file's content (including the `AGE-SECRET-KEY-…` line) in the password manager and keep an offline copy; delete the local file afterwards. The printed `age1…` line is the public key.
2. **Cloudflare account.** R2 requires a payment method on the account even though this usage stays within the free tier (10 GB storage, included operations, no egress fees).
3. **Bucket.** Create an R2 bucket with the **EU jurisdiction**. Note its S3 endpoint, `https://<account id>.eu.r2.cloudflarestorage.com`.
4. **Lifecycle rules.** Delete objects with prefix `daily/` after 30 days and with prefix `monthly/` after 365 days.
5. **Bucket lock rules.** Lock prefix `daily/` for 30 days and `monthly/` for 365 days, so a leaked workflow token cannot delete or overwrite existing backups.
6. **API token.** Create an R2 API token with **Object Read & Write** limited to this bucket. R2 offers no write-only permission; read access only exposes ciphertext, the freshness check needs to list objects, and the bucket locks prevent deletion.
7. **GitHub environment `backup`** (Settings → Environments). Deployment branches and tags: `main` and the version tag pattern (for pre-migration backups from release runs). Environment secrets:
   - `DATABASE_URL`, `DATABASE_AUTH_TOKEN`: the production libSQL URL and a database token (preferably a dedicated read-only token, so it can be revoked separately)
   - `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`: the API token's S3 credentials
   - `R2_ENDPOINT`: the EU S3 endpoint from step 3
   Environment variables:
   - `BACKUP_BUCKET`: the bucket name
   - `BACKUP_AGE_RECIPIENTS`: the `age1…` public key (one per line if there are several)
8. **First run.** Start "Database backup" manually from the Actions tab. Then download the new `.sqlite.age` object, run `age --decrypt -i <key file> -o <fresh dir>/ufer.sqlite <object>` and `npm run db:verify-backup -- --file=<fresh dir>/ufer.sqlite --check-bank-secrets` with `DATA_ENCRYPTION_KEY` from the password manager. Delete the decrypted copy afterwards.
9. **Privacy notice.** Add the backup location and retention to `DATA_PROCESSORS`.

## Open operations decisions

- The first recorded restore drill and point-in-time restore.
- Confirmation of the Turso plan, restore window and database limit.
