#!/usr/bin/env bash
# Requires the recorded PR head/base SHAs and GitHub Actions' output file.
set -euo pipefail

: "${HEAD_SHA:?Missing pull request head SHA}"
: "${BASE_SHA:?Missing pull request base SHA}"
: "${GITHUB_OUTPUT:?Missing GitHub Actions output file}"

if [ "$(git rev-parse HEAD)" != "$HEAD_SHA" ]; then
  printf '%s\n' "The checkout does not match the recorded pull request head." >&2
  exit 1
fi

git cat-file -e "${BASE_SHA}^{commit}"

if ! git merge-base --is-ancestor "$BASE_SHA" HEAD; then
  git -c user.name=github-actions[bot] -c user.email=41898282+github-actions[bot]@users.noreply.github.com merge --no-ff --no-edit "$BASE_SHA"
fi

printf 'build=%s\n' "$(git rev-parse HEAD)" >> "$GITHUB_OUTPUT"
