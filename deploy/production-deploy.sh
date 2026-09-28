#!/usr/bin/env bash
set -euo pipefail

release_dir=${1:?release checkout path is required}
secrets_dir=${2:?directory with production environment files is required}
release_tag=${QUADRASFLOW_RELEASE_TAG:-}

if [[ ! "$release_tag" =~ ^[a-f0-9]{40}$ ]]; then
  echo "Expected QUADRASFLOW_RELEASE_TAG to be a full Git commit SHA." >&2
  exit 1
fi
if [[ "$release_dir" != /opt/quadrasflow/github-release ]]; then
  echo "Refusing to deploy from an unexpected checkout path." >&2
  exit 1
fi
if [[ "$secrets_dir" != /opt/quadrasflow/secrets ]]; then
  echo "Refusing to read production secrets from an unexpected path." >&2
  exit 1
fi

for name in production.env waha.production.env staging.env; do
  if [[ ! -f "$secrets_dir/$name" ]]; then
    echo "Required protected environment file is missing: $secrets_dir/$name" >&2
    exit 1
  fi
done

for name in production.env waha.production.env staging.env; do
  link="$release_dir/deploy/$name"
  if [[ -e "$link" && ! -L "$link" ]]; then
    echo "Refusing to replace an unexpected file at $link." >&2
    exit 1
  fi
  ln -sfn "$secrets_dir/$name" "$link"
done

cd "$release_dir"
compose=(docker compose -p quadrasflow-cutover -f deploy/compose.cutover.yaml)
export QUADRASFLOW_RELEASE_TAG

# Pull the exact immutable commit images before mutating the live stack.
"${compose[@]}" pull api web

# Preserve a database snapshot before applying any migration.
backup_dir=/opt/quadrasflow/backups/github-deploy
install -d -m 700 "$backup_dir"
backup_file="$backup_dir/postgres-$(date -u +%Y%m%dT%H%M%SZ)-$release_tag.dump"
umask 077
docker exec quadrasflow-cutover-database-1 sh -c \
  'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup_file"

# Run only the migration one-off. Do not recreate or touch the database service.
"${compose[@]}" build migrate
"${compose[@]}" run --rm --no-deps migrate

# Recreate only the API and web containers; WAHA, database and persistent volumes stay up.
"${compose[@]}" up --detach --no-deps --no-build --force-recreate --wait --wait-timeout 180 api web

printf '%s\n' "$release_tag" > /opt/quadrasflow/github-release/.quadrasflow-last-release.tmp
chmod 600 /opt/quadrasflow/github-release/.quadrasflow-last-release.tmp
mv /opt/quadrasflow/github-release/.quadrasflow-last-release.tmp \
  /opt/quadrasflow/github-release/.quadrasflow-last-release
echo "QuadrasFlow release $release_tag deployed. Backup: $backup_file"
