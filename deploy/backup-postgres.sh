#!/usr/bin/env bash
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/opt/quadrasflow/backups/postgres}"
MEDIA_BACKUP_DIR="${MEDIA_BACKUP_DIR:-/opt/quadrasflow/backups/media}"
DB_CONTAINER="${DB_CONTAINER:-quadrasflow-cutover-database-1}"
MEDIA_VOLUME="${MEDIA_VOLUME:-quadrasflow-cutover_quadrasflow_media}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT="$BACKUP_DIR/quadrasflow-$STAMP.dump"
TEMP="$SNAPSHOT.partial"
MEDIA_SNAPSHOT="$MEDIA_BACKUP_DIR/quadrasflow-media-$STAMP.tar.gz"
MEDIA_TEMP="$MEDIA_SNAPSHOT.partial"

umask 077
mkdir -p "$BACKUP_DIR"
mkdir -p "$MEDIA_BACKUP_DIR"
docker exec "$DB_CONTAINER" sh -c 'pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > "$TEMP"
test -s "$TEMP"
docker exec -i "$DB_CONTAINER" pg_restore --list < "$TEMP" >/dev/null
mv "$TEMP" "$SNAPSHOT"
MEDIA_SOURCE="$(docker volume inspect --format '{{.Mountpoint}}' "$MEDIA_VOLUME")"
tar -czf "$MEDIA_TEMP" -C "$MEDIA_SOURCE" .
test -s "$MEDIA_TEMP"
tar -tzf "$MEDIA_TEMP" >/dev/null
mv "$MEDIA_TEMP" "$MEDIA_SNAPSHOT"
find "$BACKUP_DIR" -type f -name 'quadrasflow-*.dump' -mtime +14 -delete
find "$MEDIA_BACKUP_DIR" -type f -name 'quadrasflow-media-*.tar.gz' -mtime +14 -delete
printf 'Verified PostgreSQL backup: %s\n' "$SNAPSHOT"
printf 'Verified arena media backup: %s\n' "$MEDIA_SNAPSHOT"
