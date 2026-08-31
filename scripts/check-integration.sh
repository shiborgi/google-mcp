#!/usr/bin/env bash

set -euo pipefail

# Container and gateway configurations
BARBACK_GATEWAY_CONTAINER="${BARBACK_GATEWAY_CONTAINER:-barback-gateway}"
GOOGLE_MCP_PORT="${GOOGLE_MCP_PORT:-8090}"
GOOGLE_MCP_TOKEN="${GOOGLE_MCP_TOKEN:-}"

# Canonical FQDN endpoint; never derived from container inspect or an IP literal.
GOOGLE_MCP_HOST="google.mcp.barback.internal"
HEALTH_URL="http://$GOOGLE_MCP_HOST:$GOOGLE_MCP_PORT/health"
MCP_URL="http://$GOOGLE_MCP_HOST:$GOOGLE_MCP_PORT/mcp"

if [[ -z "$GOOGLE_MCP_TOKEN" ]]; then
  printf 'Error: GOOGLE_MCP_TOKEN is required\n' >&2
  exit 1
fi

# The gateway image ships Bun, so we run the checks with `bun -e` rather than
# assuming curl is installed. The script itself never inspects a container IP.
run_in_gateway() {
  container exec "$BARBACK_GATEWAY_CONTAINER" bun -e "$1"
}

# 1. Verify health endpoint (HTTP 200)
health_output="$(run_in_gateway "
const response = await fetch('$HEALTH_URL');
if (!response.ok) { console.error('status=' + response.status); process.exit(1); }
console.log('ok');
" 2>&1 || true)"

if [[ "$health_output" != "ok" ]]; then
  printf 'Error: Unreachable health endpoint\n' >&2
  exit 1
fi

# 2. Verify MCP initialize handshake
payload='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check-integration","version":"0.1.0"}}}'

mcp_output="$(run_in_gateway "
const response = await fetch('$MCP_URL', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Accept': 'application/json, text/event-stream',
    'Authorization': 'Bearer $GOOGLE_MCP_TOKEN',
  },
  body: '$payload',
});
if (response.status === 401) { console.error('status=401'); process.exit(2); }
if (!response.ok) { console.error('status=' + response.status); process.exit(3); }
const text = await response.text();
let json;
try { json = JSON.parse(text); } catch { console.error('malformed'); process.exit(4); }
if (json?.result?.serverInfo?.name !== 'google-mcp') { console.error('identity'); process.exit(5); }
console.log('ok');
" 2>&1 || true)"

case "$mcp_output" in
  "ok")
    printf 'Integration verification successful\n'
    exit 0
    ;;
  *"status=401"*)
    printf 'Error: Unauthorized token on the MCP endpoint\n' >&2
    exit 1
    ;;
  *"status="*)
    printf 'Error: Failed MCP handshake\n' >&2
    exit 1
    ;;
  *"malformed"*)
    printf 'Error: Failed MCP handshake\n' >&2
    exit 1
    ;;
  *"identity"*)
    printf 'Error: Failed MCP handshake\n' >&2
    exit 1
    ;;
  *)
    printf 'Error: Failed MCP handshake\n' >&2
    exit 1
    ;;
esac
