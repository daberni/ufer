#!/usr/bin/env bash
# Encrypts a verified export and its report to the age recipients and writes a public manifest without data.
# Usage: backup-encrypt.sh <directory with ufer.sqlite and report.json>
# Environment: BACKUP_AGE_RECIPIENTS (one age public key per line), REASON, SOURCE_COMMIT, GITHUB_SHA
set -euo pipefail

directory="$1"
recipients="$directory/recipients.txt"

printf '%s\n' "$BACKUP_AGE_RECIPIENTS" > "$recipients"

if ! grep -Eq '^age1[0-9a-z]+$' "$recipients"; then
  echo "::error::BACKUP_AGE_RECIPIENTS must contain age public keys (age1…), one per line."
  exit 1
fi

age --encrypt --recipients-file "$recipients" --output "$directory/ufer.sqlite.age" "$directory/ufer.sqlite"
age --encrypt --recipients-file "$recipients" --output "$directory/report.json.age" "$directory/report.json"

sha256() {
  sha256sum "$1" | cut -d ' ' -f 1
}

jq -n \
  --arg createdAt "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  --arg reason "$REASON" \
  --arg sourceCommit "$SOURCE_COMMIT" \
  --arg workflowCommit "$GITHUB_SHA" \
  --argjson appliedMigrations "$(jq '.appliedMigrations' "$directory/report.json")" \
  --arg plaintextSha256 "$(sha256 "$directory/ufer.sqlite")" \
  --arg ciphertextSha256 "$(sha256 "$directory/ufer.sqlite.age")" \
  --argjson ciphertextBytes "$(stat -c %s "$directory/ufer.sqlite.age")" \
  '{createdAt: $createdAt, reason: $reason, sourceCommit: $sourceCommit, workflowCommit: $workflowCommit, appliedMigrations: $appliedMigrations, plaintextSha256: $plaintextSha256, ciphertextSha256: $ciphertextSha256, ciphertextBytes: $ciphertextBytes}' \
  > "$directory/manifest.json"
