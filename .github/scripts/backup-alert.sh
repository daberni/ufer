#!/usr/bin/env bash
# Opens one backup alert issue, or comments on the open one, linking the failed run. Never includes data.
# Usage: backup-alert.sh <message>
# Environment: GH_TOKEN, GITHUB_REPOSITORY, GITHUB_SERVER_URL, GITHUB_RUN_ID
set -euo pipefail

title="Database backup alert"
label="ops-alert"
body="$1 Run: ${GITHUB_SERVER_URL}/${GITHUB_REPOSITORY}/actions/runs/${GITHUB_RUN_ID}"

gh label create "$label" --repo "$GITHUB_REPOSITORY" --color B60205 --description "Operational alert raised by a workflow" --force > /dev/null
existing=$(gh issue list --repo "$GITHUB_REPOSITORY" --state open --label "$label" --search "\"$title\" in:title" --json number --jq '.[0].number // empty')

if [ -n "$existing" ]; then
  gh issue comment "$existing" --repo "$GITHUB_REPOSITORY" --body "$body"
else
  gh issue create --repo "$GITHUB_REPOSITORY" --title "$title" --label "$label" --body "$body Close this issue once backups succeed again."
fi
