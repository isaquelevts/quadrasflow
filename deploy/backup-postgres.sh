#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/quadrasflow/backups/postgres}"
DB_CONTAINER="${DB_CONTAINER:-quadrasflow-cutover-database-1}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT="$BACKUP_DIR/quadrasflow-$STAMP.dump"
TEMP="$SNAPSHOT.partial"

umask 077
mkdir -p "$BACKUP_DIR"
docker exec "$DB_CONTAINER" sh -c 'pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$TEMP"
test -s "$TEMP"
docker exec -i "$DB_CONTAINER" pg_restore --list < "$TEMP" >/dev/null
mv "$TEMP" "$SNAPSHOT"
find "$BACKUP_DIR" -type f -name 'quadrasflow-*.dump' -mtime +14 -delete
printf 'Verified PostgreSQL backup: %s\n' "$SNAPSHOT"
