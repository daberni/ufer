#!/usr/bin/env bash
# Starts the built application against a local database copy and checks that it serves a request that reads the database.
# A rejected sign-in (401) proves startup, migration-history verification and queries against the authentication tables.
# Usage: rehearsal-smoke.sh <sqlite file>   (run after `npm run build`)
set -euo pipefail

database="$1"
port=3123
origin="https://rehearsal.invalid"
log="$RUNNER_TEMP/rehearsal-server.log"

# Throwaway secrets: the rehearsal never decrypts bank sessions or keeps a session.
DATABASE_URL="file:$database" DATABASE_AUTH_TOKEN="" APP_URL="$origin" PORT="$port" \
  BETTER_AUTH_SECRET="$(openssl rand -hex 32)" DATA_ENCRYPTION_KEY="$(openssl rand -hex 32)" \
  NEXT_TELEMETRY_DISABLED=1 npx next start --hostname 127.0.0.1 --port "$port" > "$log" 2>&1 &
server=$!
trap 'kill "$server" 2> /dev/null || true' EXIT

for _ in $(seq 1 60); do
  if curl -s -o /dev/null "http://127.0.0.1:$port/"; then
    break
  fi
  sleep 1
done

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port/api/auth/sign-in/username" -H "Origin: $origin" -H "Content-Type: application/json" --data '{"username":"rehearsal","password":"not-a-real-password"}')

if [ "$status" != "401" ]; then
  echo "::error::The release build did not serve a rejected sign-in against the migrated copy (HTTP $status)."
  exit 1
fi

echo "Rehearsal: the release build started on the migrated copy and answered a database-backed sign-in check with 401." >> "$GITHUB_STEP_SUMMARY"
