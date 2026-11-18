# Backup and restore

The offline verifier and synthetic recovery rehearsal below are implemented. Automated external backups, hosted point-in-time recovery and a restore of real hosted data are not configured or verified by this work. Track the remaining operations in [#84](https://github.com/daberni/ufer/issues/84).

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

The file must already exist. The command opens it read-only and checks SQLite integrity, foreign keys, exact applied migration identities/checksums and the presence/counts of the application's tables. It does not create a missing database, apply migrations, repair data, load `.env` files, use `DATABASE_URL` as a fallback or call a bank/provider. A pending, changed or newer migration history fails; select the matching application revision rather than bypassing it.

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

Additional cases verify rejection of missing/corrupt artifacts, broken foreign keys, altered/pending migration history and wrong encryption keys. File checksums remain unchanged during verification. The missing-key check is explicit rather than silently counted as complete recovery. These checks were exercised only with synthetic local data; they do not replace a restore trial of an actual authorized hosted export.

## Open operations decisions

- Required recoverable history, acceptable data loss and recovery objectives; the hosted plan's actual restore window and restore capabilities must be confirmed before choosing a plan.
- Independent backup storage provider/location, access and encryption, retention/deletion policy, and corresponding `DATA_PROCESSORS`/privacy disclosures.
- Export frequency, scheduling, failure monitoring and the credentials needed for that job; no schedule or cloud credential was created here.
- Authorization and an isolated target for a real export/PITR rehearsal, including secret-version recovery and any permitted bank requests.
