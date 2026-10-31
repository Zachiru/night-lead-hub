#!/usr/bin/env bash
# Spins up a throwaway Postgres, loads the schema, runs the security tests.
set -euo pipefail
cd "$(dirname "$0")"
PGBIN=${PGBIN:-/usr/lib/postgresql/16/bin}
DIR=$(mktemp -d)
cleanup() { "$PGBIN/pg_ctl" -D "$DIR/data" stop -m immediate >/dev/null 2>&1 || true; rm -rf "$DIR"; }
trap cleanup EXIT
RUNAS=""
if [ "$(id -u)" = "0" ]; then chown -R postgres "$DIR" 2>/dev/null || true; RUNAS="runuser -u postgres --"; chown postgres "$DIR"; fi
$RUNAS "$PGBIN/initdb" -D "$DIR/data" -A trust -U postgres >/dev/null
$RUNAS "$PGBIN/pg_ctl" -D "$DIR/data" -o "-k $DIR -p 54329 -c listen_addresses=''" -l "$DIR/log" start >/dev/null
PSQL="psql -o /dev/stdout -h $DIR -p 54329 -U postgres -v ON_ERROR_STOP=1 -q -X -t -A"
$PSQL -c "create database t" >/dev/null
$PSQL -d t -f supabase_stub.sql >/dev/null
$PSQL -d t -f ../../supabase/schema.sql >/dev/null
$PSQL -d t -f ../../supabase/schema.sql >/dev/null   # must be safe to run twice
$PSQL -d t -f security_tests.sql
if [ -n "${PARITY_OUT:-}" ]; then $PSQL -d t -f parity.sql -t -A > "$PARITY_OUT"; fi
