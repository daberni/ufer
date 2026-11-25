#!/usr/bin/env bash
# Keeps only the first <count> changesets of a drizzle/sqlite directory, as the database at that point in history knows them.
# Usage: trim-changesets.sh <changeset directory> <count>
set -euo pipefail

directory="$1"
count="$2"
journal="$directory/meta/_journal.json"
available=$(jq '.entries | length' "$journal")

if [ "$count" -gt "$available" ]; then
  echo "::error::The database has $count applied changesets, but the selected release only has $available."
  exit 1
fi

jq --argjson count "$count" '.entries |= .[:$count]' "$journal" > "$journal.tmp"
mv "$journal.tmp" "$journal"
kept=$(jq -r '.entries[].tag + ".sql"' "$journal")

for file in "$directory"/*.sql; do
  if ! grep -qxF "$(basename "$file")" <<< "$kept"; then
    rm "$file"
  fi
done
