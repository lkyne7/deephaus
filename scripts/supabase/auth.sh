#!/usr/bin/env bash
# Authenticate Supabase CLI and link this repo to the remote project.
#
# 1. Create an access token: https://supabase.com/dashboard/account/tokens
# 2. Run: SUPABASE_ACCESS_TOKEN=sbp_xxx ./scripts/supabase/auth.sh
#
# Optional: place POSTGRES_PASSWORD in .env.vercel.production (from `pnpm vercel:env:pull`).

set -euo pipefail
cd "$(dirname "$0")/../.."

PROJECT_REF="rdfijwmxlyvykcnxfurd"

if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
  echo "Missing SUPABASE_ACCESS_TOKEN."
  echo "Create one at https://supabase.com/dashboard/account/tokens then re-run:"
  echo "  SUPABASE_ACCESS_TOKEN=sbp_xxx ./scripts/supabase/auth.sh"
  exit 1
fi

npx supabase login --token "$SUPABASE_ACCESS_TOKEN"

DB_PASSWORD="${POSTGRES_PASSWORD:-}"
if [[ -z "$DB_PASSWORD" && -f .env.vercel.production ]]; then
  DB_PASSWORD="$(grep -E '^POSTGRES_PASSWORD=' .env.vercel.production | cut -d= -f2- | tr -d '"')"
fi

if [[ -n "$DB_PASSWORD" ]]; then
  npx supabase link --project-ref "$PROJECT_REF" --password "$DB_PASSWORD"
else
  echo "Linking project (you may be prompted for the database password)..."
  npx supabase link --project-ref "$PROJECT_REF"
fi

echo ""
echo "Done. Verify with: pnpm supabase:status"
