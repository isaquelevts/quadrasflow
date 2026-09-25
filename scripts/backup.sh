#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DATA_DIR:-./data}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_REMOTE="${BACKUP_REMOTE:-}"
DB_PATH="$DATA_DIR/quadrasflow.sqlite"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
SNAPSHOT="$BACKUP_DIR/quadrasflow-$STAMP.sqlite"

if [[ ! -f "$DB_PATH" ]]; then
  echo "Banco não encontrado: $DB_PATH" >&2
  exit 1
fi
command -v sqlite3 >/dev/null || { echo "Instale sqlite3 para gerar um snapshot consistente." >&2; exit 1; }
mkdir -p "$BACKUP_DIR"
sqlite3 "$DB_PATH" ".backup '$SNAPSHOT'"
sqlite3 "$SNAPSHOT" 'PRAGMA integrity_check;' | grep -qx 'ok'
find "$BACKUP_DIR" -type f -name 'quadrasflow-*.sqlite' -mtime +14 -delete

if [[ -n "$BACKUP_REMOTE" ]]; then
  command -v rclone >/dev/null || { echo "BACKUP_REMOTE foi configurado, mas rclone não está instalado." >&2; exit 1; }
  rclone copy "$SNAPSHOT" "$BACKUP_REMOTE/"
else
  echo "Aviso: backup local criado; configure BACKUP_REMOTE para manter uma cópia fora da VPS." >&2
fi
echo "$SNAPSHOT"
