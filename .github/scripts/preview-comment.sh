#!/usr/bin/env bash
# Usage: preview-comment.sh <building|ready|error> [preview URL] [inspector URL]
set -euo pipefail

status="$1"
preview_url="${2:-}"
inspector_url="${3:-}"
marker="<!-- preview-deployment -->"
run_url="$GITHUB_SERVER_URL/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID"
updated="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
updated_label="$(date -u '+%b %-d, %Y %-I:%M%P UTC')"

case "$status" in
  building) label="Building" ;;
  ready) label="Ready" ;;
  error) label="Error" ;;
  *) echo "Unknown status: $status" >&2; exit 1 ;;
esac

details_url="${inspector_url:-$run_url}"
project="ufer"

if [ -n "$inspector_url" ]; then
  project="[ufer](${inspector_url%/*})"
fi

actions="—"

if [ "$status" = "ready" ] && [ -n "$preview_url" ]; then
  actions="[Preview]($preview_url)"
fi

source_details="PR head: [\`${HEAD_SHA:0:7}\`]($GITHUB_SERVER_URL/$GITHUB_REPOSITORY/commit/$HEAD_SHA)."

body="$(cat <<EOF
$marker
Preview deployment (\`preview\` label). Remove the label to stop deploying new commits.

$source_details

| Project | Deployment | Actions | Updated |
| :--- | :----- | :------ | :------ |
| $project | ![$label](https://vercel.com/static/status/$status.svg) [$label]($details_url) | $actions | <relative-time datetime="$updated">$updated_label</relative-time> |
EOF
)"

existing="$(gh api "repos/$GITHUB_REPOSITORY/issues/$PULL_REQUEST/comments" --paginate --jq ".[] | select(.user.login == \"github-actions[bot]\" and (.body | startswith(\"$marker\"))) | .id" | head -n 1)"

if [ -n "$existing" ]; then
  gh api --method PATCH "repos/$GITHUB_REPOSITORY/issues/comments/$existing" -f body="$body" > /dev/null
else
  gh api --method POST "repos/$GITHUB_REPOSITORY/issues/$PULL_REQUEST/comments" -f body="$body" > /dev/null
fi
