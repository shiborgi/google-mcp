import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = new URL("../../scripts/check-integration.sh", import.meta.url).pathname;

const STUB = `#!/usr/bin/env bash
cmd="$1"; shift
case "$cmd" in
  exec)
    gateway="$1"; shift
    [[ "$gateway" == "$STUB_EXPECTED_GATEWAY_CONTAINER" ]] || exit 1
    # args: bun -e <script>
    [[ "$1" == "bun" ]] || exit 1
    script="$3"

    token_ok=0
    accept_ok=0
    if [[ "$script" == *"Bearer $STUB_EXPECTED_TOKEN"* ]]; then
      token_ok=1
    fi
    if [[ "$script" == *"text/event-stream"* ]]; then
      accept_ok=1
    fi

    if [[ "$script" == *"/health"* ]]; then
      if [[ "$STUB_HEALTH_FAIL" == "1" ]]; then
        printf 'status=503\n'
        exit 1
      fi
      printf 'ok\n'
      exit 0
    fi

    if [[ "$script" == *"/mcp"* ]]; then
      if [[ "$token_ok" -eq 0 ]]; then
        printf 'status=401\n'
        exit 1
      fi
      if [[ "$accept_ok" -eq 0 ]]; then
        printf 'status=406\n'
        exit 1
      fi
      if [[ "$STUB_MCP_FAIL_HANDSHAKE" == "1" ]]; then
        printf 'identity\n'
        exit 1
      fi
      if [[ "$STUB_MCP_MALFORMED" == "1" ]]; then
        printf 'malformed\n'
        exit 1
      fi
      printf 'ok\n'
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
      STUB_HEALTH_FAIL: "0",
      STUB_MCP_FAIL_HANDSHAKE: "0",
    });
    expect(exitCode).toBe(0);
    expect(stdout).toContain("Integration verification successful");
    expect(stderr).toBe("");
  });

  test("exits non-zero with distinct error when GOOGLE_MCP_TOKEN is missing", () => {
    const { exitCode, stderr } = runScript({ GOOGLE_MCP_TOKEN: "" });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("GOOGLE_MCP_TOKEN is required");
  });

  test("exits non-zero with distinct error when health endpoint is unreachable", () => {
    const { exitCode, stderr } = runScript({ STUB_HEALTH_FAIL: "1" });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: Unreachable health endpoint");
  });

  test("exits non-zero with distinct error when token is unauthorized (401)", () => {
    const { exitCode, stderr } = runScript({
      STUB_HEALTH_FAIL: "0",
      GOOGLE_MCP_TOKEN: "invalid-token",
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: Unauthorized token on the MCP endpoint");
  });

  test("exits non-zero with distinct error when MCP handshake fails (wrong identity)", () => {
    const { exitCode, stderr } = runScript({
      STUB_HEALTH_FAIL: "0",
      STUB_MCP_FAIL_HANDSHAKE: "1",
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: Failed MCP handshake");
  });

  test("exits non-zero with distinct error when MCP response is malformed", () => {
    const { exitCode, stderr } = runScript({
      STUB_HEALTH_FAIL: "0",
      STUB_MCP_MALFORMED: "1",
    });
    expect(exitCode).not.toBe(0);
    expect(stderr).toContain("Error: Failed MCP handshake");
  });

  test("never prints the token or response secrets", () => {
    const { stdout, stderr } = runScript({
      STUB_HEALTH_FAIL: "0",
      STUB_MCP_FAIL_HANDSHAKE: "0",
    });
    expect(stdout).not.toContain("valid-token");
    expect(stderr).not.toContain("valid-token");
  });
});
