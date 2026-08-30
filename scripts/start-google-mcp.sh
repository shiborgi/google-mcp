#!/usr/bin/env bash

set -euo pipefail

root_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
app_name="${GOOGLE_MCP_CONTAINER:-google-mcp}"
image="${GOOGLE_MCP_IMAGE:-google-mcp:local}"
port="${GOOGLE_MCP_PORT:-8090}"
env_file="${GOOGLE_MCP_ENV_FILE:-$root_dir/.env}"
network="${BARBACK_CONTAINER_NETWORK:-}"
resolver="${BARBACK_DNS_RESOLVER:-}"
search="${BARBACK_DNS_SEARCH:-barback.internal}"
stack_id="${BARBACK_STACK_ID:-}"
readiness_attempts="${GOOGLE_MCP_READINESS_ATTEMPTS:-30}"

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

require_barback_input() {
  local name="$1" value="$2"
  if [[ -z "$value" ]]; then
    fail "missing required managed-runtime input: set $name (Barback stack contract)"
  fi
}

require_barback_input "BARBACK_CONTAINER_NETWORK" "$network"
require_barback_input "BARBACK_DNS_RESOLVER" "$resolver"
require_barback_input "BARBACK_DNS_SEARCH" "$search"
require_barback_input "BARBACK_STACK_ID" "$stack_id"
[[ "$stack_id" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]] \
  || fail "invalid stack identity '$stack_id': BARBACK_STACK_ID must be lowercase alphanumeric with inner hyphens"

if ! command -v container >/dev/null 2>&1; then
  fail "Apple Container CLI not found. Install it and try again."
fi

if [[ ! -f "$env_file" ]]; then
  fail "environment file not found: $env_file (create it from .env.example)."
fi

if ! container system status >/dev/null 2>&1; then
  printf 'Starting Apple Container services...\n'
  container system start
fi

if ! container network inspect "$network" >/dev/null 2>&1; then
  fail "network '$network' does not exist; Barback owns network creation. Create the Barback stack first."
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
  --dns "$resolver" \
  --dns-search "$search" \
  --label "io.shiborgi.barback.stack=$stack_id" \
  --label "io.shiborgi.barback.service=google" \
  --label "io.shiborgi.barback.role=mcp" \
  --env-file "$env_file" \
  --env GOOGLE_MCP_PORT="$port" \
  "$image"

for _ in $(seq 1 "$readiness_attempts"); do
  if container exec "$app_name" bun -e 'const response = await fetch(`http://127.0.0.1:${process.env.GOOGLE_MCP_PORT}/health`); if (!response.ok) process.exit(1); console.log(await response.text());' 2>/dev/null; then
    printf 'google-mcp is healthy.\n'
    printf 'GOOGLE_MCP_URL=http://google.mcp.barback.internal:%s/mcp\n' "$port"
    exit 0
  fi
  sleep 1
done

printf 'google-mcp did not become healthy. Check logs with: container logs %s\n' "$app_name" >&2
exit 1