#!/usr/bin/env bash
# Reads the migration status of the configured database and writes the pending changesets with their SQL to the job summary.
# The SQL is already public in the repository; the summary never contains data.
# Usage: migration-plan.sh <title>
# Environment: DATABASE_URL (libsql://…), DATABASE_AUTH_TOKEN; outputs pending, changesets, applied
set -euo pipefail

title="$1"

case "${DATABASE_URL:-}" in
  libsql://*|https://*) ;;
  *)
    echo "::error::DATABASE_URL must name the remote libSQL database."
    exit 1
    ;;
esac

report=$(npm run --silent db:status)
mode=$(jq -r '.mode' <<< "$report")

if [ "$mode" != "managed" ]; then
  echo "::error::Expected a managed database with migration history, found mode '$mode'."
  exit 1
fi

pending=$(jq -r '.pendingChangesets | length > 0' <<< "$report")

{
  echo "pending=$pending"
  echo "applied=$(jq -r '.applied' <<< "$report")"
  echo "changesets=$(jq -c '.pendingChangesets' <<< "$report")"
} >> "$GITHUB_OUTPUT"

{
  echo "## $title"
  echo
  echo "Applied changesets: $(jq -r '.applied' <<< "$report")"
  echo
  if [ "$pending" != "true" ]; then
    echo "No pending changesets."
    exit 0
  fi
  echo "Pending changesets:"
  echo
  jq -r '.pendingChangesets[] | "- `\(.)`"' <<< "$report"
  for file in $(jq -r '.pendingChangesets[]' <<< "$report"); do
    echo
    echo "<details><summary>$file</summary>"
    echo
    echo '```sql'
    cat "drizzle/sqlite/$file"
    echo
    echo '```'
    echo "</details>"
  done
} >> "$GITHUB_STEP_SUMMARY"
