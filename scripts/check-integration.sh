#!/usr/bin/env bash

set -euo pipefail

# Container and gateway configurations
GOOGLE_MCP_CONTAINER="${GOOGLE_MCP_CONTAINER:-google-mcp}"
BARBACK_GATEWAY_CONTAINER="${BARBACK_GATEWAY_CONTAINER:-barback-gateway}"
GOOGLE_MCP_PORT="${GOOGLE_MCP_PORT:-8090}"
GOOGLE_MCP_TOKEN="${GOOGLE_MCP_TOKEN:-}"

# 1. Resolve container IP
raw_address="$(container inspect "$GOOGLE_MCP_CONTAINER" | plutil -extract '0.status.networks.0.ipv4Address' raw - 2>/dev/null || true)"
ip="${raw_address%%/*}"

if [[ -z "$ip" ]]; then
  printf 'Error: DNS-free IP resolution failed\n' >&2
  exit 1
fi

# 2. Verify health endpoint
if ! container exec "$BARBACK_GATEWAY_CONTAINER" curl -sSf "http://$ip:$GOOGLE_MCP_PORT/health" >/dev/null 2>&1; then
  printf 'Error: Unreachable health endpoint\n' >&2
  exit 1
fi

# 3. Verify MCP initialize handshake
payload='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"check-integration","version":"0.1.0"}}}'

mcp_url="http://$ip:$GOOGLE_MCP_PORT/mcp"
mcp_response="$(container exec "$BARBACK_GATEWAY_CONTAINER" curl -sS -X POST \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -H "Authorization: Bearer $GOOGLE_MCP_TOKEN" \
  -d "$payload" \
  -w '\n%{http_code}' "$mcp_url" 2>/dev/null || true)"

if [[ -z "$mcp_response" ]]; then
  printf 'Error: Failed MCP handshake\n' >&2
  exit 1
fi

if [[ "$mcp_response" != *$'\n'* ]]; then
  printf 'Error: Failed MCP handshake\n' >&2
  exit 1
fi

http_code="${mcp_response##*$'\n'}"
body="${mcp_response%$'\n'*}"

if [[ "$http_code" == "401" ]]; then
  printf 'Error: Unauthorized token on the MCP endpoint\n' >&2
  exit 1
fi

if [[ "$http_code" != "200" ]]; then
  printf 'Error: Failed MCP handshake\n' >&2
  exit 1
fi

if [[ "$body" != *"\"google-mcp\""* ]]; then
  printf 'Error: Failed MCP handshake\n' >&2
  exit 1
fi

printf 'Integration verification successful\n'
exit 0
