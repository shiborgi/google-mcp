import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = new URL("../../scripts/check-integration.sh", import.meta.url).pathname;

const STUB = `#!/usr/bin/env bash
cmd="$1"; shift
case "$cmd" in
  inspect)
    if [[ "$1" == "$STUB_EXPECTED_MCP_CONTAINER" && -n "$STUB_IP_JSON" ]]; then
      printf '%s' "$STUB_IP_JSON"
      exit 0
    fi
    exit 1
    ;;
  exec)
    gateway="$1"; shift
    [[ "$gateway" == "$STUB_EXPECTED_GATEWAY_CONTAINER" ]] || exit 1

    url=""
    token_ok=0
    accept_ok=0
    for arg in "$@"; do
      if [[ "$arg" == http://* ]]; then
        url="$arg"
      fi
      if [[ "$arg" == "Authorization: Bearer $STUB_EXPECTED_TOKEN" ]]; then
        token_ok=1
      fi
      if [[ "$arg" == "Accept: application/json, text/event-stream" ]]; then
        accept_ok=1
      fi
    done

    if [[ "$url" == *"/health" ]]; then
      if [[ "$STUB_HEALTH_FAIL" == "1" ]]; then
        exit 7
      fi
      echo '{"status":"ready"}'
      exit 0
    fi

    if [[ "$url" == *"/mcp" ]]; then
      if [[ "$token_ok" -eq 0 ]]; then
        printf '{"error":"Unauthorized"}\n401\n'
        exit 0
      fi
      if [[ "$accept_ok" -eq 0 ]]; then
        printf '{"error":"Not Acceptable"}\n406\n'
        exit 0
      fi
      if [[ "$STUB_MCP_FAIL_HANDSHAKE" == "1" ]]; then
        printf '{"result":{"serverInfo":{"name":"wrong-server"}}}\n200\n'
        exit 0
      fi
      printf '{"result":{"serverInfo":{"name":"google-mcp"}}}\n200\n'
      exit 0
    fi
    exit 127
    ;;
  *)
    exit 0
    ;;
esac
`;

const dirs: string[] = [];

function runScript(envOverrides: Record<string, string>) {
  const dir = mkdtempSync(join(tmpdir(), "google-mcp-integration-"));
  dirs.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const stub = join(bin, "container");
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);

  const proc = Bun.spawnSync(["bash", scriptPath], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      STUB_EXPECTED_MCP_CONTAINER: "google-mcp",
      STUB_EXPECTED_GATEWAY_CONTAINER: "barback-gateway",
      STUB_EXPECTED_TOKEN: "valid-token",
      GOOGLE_MCP_TOKEN: "valid-token",
      ...envOverrides,
    },
  });
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("check-integration.sh", () => {
  test("exits 0 and reports success when health and mcp handshake succeed", () => {
    const { exitCode, stdout, stderr } = runScript({
      STUB_IP_JSON: '[{"status":{"networks":[{"ipv4Address":"192.168.64.30/24"}]}}]',
      STUB_HEALTH_FAIL: "0",
      STUB_MCP_FAIL_HANDSHAKE: "0",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Integration verification successful");
    expect(stderr).toBe("");
  });

  test("exits non-zero with distinct error when IP resolution fails", () => {
    const { exitCode, stderr } = runScript({ STUB_IP_JSON: "" });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: DNS-free IP resolution failed");
  });

  test("exits non-zero with distinct error when health endpoint is unreachable", () => {
    const { exitCode, stderr } = runScript({
      STUB_IP_JSON: '[{"status":{"networks":[{"ipv4Address":"192.168.64.30/24"}]}}]',
      STUB_HEALTH_FAIL: "1",
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: Unreachable health endpoint");
  });

  test("exits non-zero with distinct error when token is unauthorized (401)", () => {
    const { exitCode, stderr } = runScript({
      STUB_IP_JSON: '[{"status":{"networks":[{"ipv4Address":"192.168.64.30/24"}]}}]',
      STUB_HEALTH_FAIL: "0",
      GOOGLE_MCP_TOKEN: "invalid-token",
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: Unauthorized token on the MCP endpoint");
  });

  test("exits non-zero with distinct error when MCP handshake fails", () => {
    const { exitCode, stderr } = runScript({
      STUB_IP_JSON: '[{"status":{"networks":[{"ipv4Address":"192.168.64.30/24"}]}}]',
      STUB_HEALTH_FAIL: "0",
      STUB_MCP_FAIL_HANDSHAKE: "1",
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: Failed MCP handshake");
  });
});
