#!/usr/bin/env bash
# Uploads the encrypted backup, its encrypted report and the public manifest to R2.
# Objects go to daily/ (30-day lifecycle rule); a nightly run on the first of the month also writes monthly/ (365 days).
# Usage: backup-upload.sh <directory>
# Environment: R2_BUCKET, REASON, AWS_* credentials and endpoint
set -euo pipefail

directory="$1"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
reason=$(printf '%s' "${REASON:?}" | tr -c 'a-zA-Z0-9.-' '-')
name="ufer-${stamp}-${reason}"
prefixes=("daily/$(date -u +%Y/%m)")

if [ "$REASON" = "nightly" ] && [ "$(date -u +%d)" = "01" ]; then
  prefixes+=("monthly/$(date -u +%Y)")
fi

for prefix in "${prefixes[@]}"; do
  for file in ufer.sqlite.age report.json.age manifest.json; do
    suffix="${file#ufer.}"
    aws s3 cp --only-show-errors "$directory/$file" "s3://${R2_BUCKET}/${prefix}/${name}.${suffix}"
  done
done

object="${prefixes[0]}/${name}.sqlite.age"

echo "object=$object" >> "$GITHUB_OUTPUT"
{
  echo "## Database backup uploaded"
  echo
  echo "| Field | Value |"
  echo "| --- | --- |"
  echo "| Object | \`$object\` |"
  echo "| Copies | ${#prefixes[@]} |"
  jq -r '"| Source commit | `\(.sourceCommit)` |\n| Applied migrations | \(.appliedMigrations) |\n| Ciphertext SHA-256 | `\(.ciphertextSha256)` |"' "$directory/manifest.json"
} >> "$GITHUB_STEP_SUMMARY"
