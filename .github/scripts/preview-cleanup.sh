#!/usr/bin/env bash
# Usage: preview-cleanup.sh [deployment URL to keep]
# Removes this pull request's Vercel preview deployments (meta githubPullRequest=$PULL_REQUEST), except the kept one.
# Production deployments are never selected: the listing is filtered to the preview environment and each target is checked again.
set -euo pipefail

keep_host="${1:-}"
keep_host="${keep_host#https://}"
keep_host="${keep_host%%/*}"
vercel=(npx --yes vercel@65.16.0)
urls=()
cursor=""

while :; do
  args=(list --yes --json --environment preview --limit 100 --meta "githubPullRequest=$PULL_REQUEST" --token "$VERCEL_TOKEN")
  if [ -n "$cursor" ]; then
    args+=(--next "$cursor")
  fi
  page="$("${vercel[@]}" "${args[@]}")"
  while IFS= read -r url; do
    if [ -n "$url" ]; then
      urls+=("$url")
    fi
  done < <(jq -r --arg keep "$keep_host" --arg pr "$PULL_REQUEST" '
    .deployments[]
    | select((.target // "preview") != "production")
    | select((.meta.githubPullRequest // "") == $pr)
    | select(.url != null and .url != $keep)
    | .url' <<< "$page")
  cursor="$(jq -r '.pagination.next // empty' <<< "$page")"
  if [ -z "$cursor" ]; then
    break
  fi
done

if [ "${#urls[@]}" -eq 0 ]; then
  echo "No preview deployments to remove for pull request #$PULL_REQUEST."
  exit 0
fi

echo "Removing ${#urls[@]} preview deployment(s) for pull request #$PULL_REQUEST: ${urls[*]}"
confirm=()
for url in "${urls[@]}"; do
  confirm+=(--confirm-name "$url")
done
"${vercel[@]}" remove "${urls[@]}" "${confirm[@]}" --token "$VERCEL_TOKEN"
