#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app_name="${GOOGLE_MCP_CONTAINER:-google-mcp}"
image="${GOOGLE_MCP_IMAGE:-google-mcp:local}"
network="${BARBACK_CONTAINER_NETWORK:-default}"
port="${GOOGLE_MCP_PORT:-8090}"
env_file="${GOOGLE_MCP_ENV_FILE:-$root_dir/.env}"

if ! command -v container >/dev/null 2>&1; then
  printf 'Apple Container CLI not found. Install it and try again.\n' >&2
  exit 1
fi

if [[ ! -f "$env_file" ]]; then
  printf 'Environment file not found: %s\n' "$env_file" >&2
  printf 'Create it with: cp .env.example .env and fill the Google credentials.\n' >&2
  exit 1
fi

if ! container system status >/dev/null 2>&1; then
  printf 'Starting Apple Container services...\n'
  container system start
fi

if ! container network inspect "$network" >/dev/null 2>&1; then
  printf 'Creating Apple Container network: %s\n' "$network"
  container network create "$network"
fi

printf 'Building MCP server image: %s\n' "$image"
container build --tag "$image" "$root_dir"

if container inspect "$app_name" >/dev/null 2>&1; then
  if container list --format json | grep -Fq "\"id\":\"$app_name\""; then
    printf 'Restarting MCP container: %s\n' "$app_name"
    container stop "$app_name"
  fi
  container delete "$app_name"
fi

printf 'Starting MCP container on the %s network: %s\n' "$network" "$app_name"
container run \
  --detach \
  --name "$app_name" \
  --network "$network" \
  --publish "127.0.0.1:${port}:${port}" \
  --env-file "$env_file" \
  --env GOOGLE_MCP_PORT="$port" \
  "$image"

for _ in {1..30}; do
  if container exec "$app_name" bun -e 'const response = await fetch(`http://127.0.0.1:${process.env.GOOGLE_MCP_PORT}/health`); if (!response.ok) process.exit(1); console.log(await response.text());' 2>/dev/null; then
    printf 'google-mcp is running on 127.0.0.1:%s (network %s)\n' "$port" "$network"
    exit 0
  fi
  sleep 1
done

printf 'google-mcp did not become healthy. Check logs with: container logs %s\n' "$app_name" >&2
exit 1
