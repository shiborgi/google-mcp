import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const integrationPath = new URL("../integration/address-replacement.test.ts", import.meta.url)
  .pathname;
const dirs: string[] = [];

const STUB = `#!/usr/bin/env bash
cmd="$1"
printf '%s\n' "$*" >> "$STUB_LOG"
case "$cmd" in
  system|network)
    exit 0
    ;;
  list)
    printf '%s\n' '[]'
    exit 0
    ;;
  inspect)
    name="$2"
    if [[ "$name" == "$STUB_GATEWAY" ]]; then
      printf '%s\n' '[{"id":"gateway-id","status":{"state":"running"},"configuration":{}}]'
      exit 0
    fi
    if [[ "$name" != "$STUB_TARGET" ]]; then
      printf '%s\n' '[]'
      exit 0
    fi
    if [[ "$STUB_EXISTING" == "1" ]]; then
      printf '%s\n' '[{"id":"existing-id","status":{"state":"running","networks":[{"ipv4Address":"192.0.2.99/24"}]},"configuration":{"networks":[{"network":"barback-test-net"}]}}]'
      exit 0
    fi
    phase=""
    if [[ -f "$STUB_PHASE" ]]; then phase="$(<"$STUB_PHASE")"; fi
    case "$phase" in
      first)
        printf '%s\n' '[{"id":"created-id-1","status":{"state":"running","networks":[{"ipv4Address":"192.0.2.10/24"}]},"configuration":{"networks":[{"network":"barback-test-net"}],"labels":{"io.shiborgi.barback.stack":"barback-test","io.shiborgi.barback.service":"google","io.shiborgi.barback.role":"mcp","io.shiborgi.google-mcp.address-replacement-test":"true"}}}]'
        exit 0
        ;;
      second)
        if [[ "$STUB_SAME_ADDRESS" == "1" ]]; then
          printf '%s\n' '[{"id":"created-id-2","status":{"state":"running","networks":[{"ipv4Address":"192.0.2.10/24"}]},"configuration":{"networks":[{"network":"barback-test-net"}],"labels":{"io.shiborgi.barback.stack":"barback-test","io.shiborgi.barback.service":"google","io.shiborgi.barback.role":"mcp","io.shiborgi.google-mcp.address-replacement-test":"true"}}}]'
        else
          printf '%s\n' '[{"id":"created-id-2","status":{"state":"running","networks":[{"ipv4Address":"192.0.2.11/24"}]},"configuration":{"networks":[{"network":"barback-test-net"}],"labels":{"io.shiborgi.barback.stack":"barback-test","io.shiborgi.barback.service":"google","io.shiborgi.barback.role":"mcp","io.shiborgi.google-mcp.address-replacement-test":"true"}}}]'
        fi
        exit 0
        ;;
      *)
        printf '%s\n' '[]'
        exit 0
        ;;
    esac
    ;;
  run)
    [[ "$*" == *"--name $STUB_TARGET"* ]] || exit 1
    if [[ ! -s "$STUB_PHASE" ]]; then
      printf '%s' first > "$STUB_PHASE"
    else
      printf '%s' second > "$STUB_PHASE"
    fi
    exit 0
    ;;
  stop)
    [[ "$2" == "$STUB_TARGET" ]] || exit 1
    exit 0
    ;;
  delete)
    [[ "$2" == "$STUB_TARGET" ]] || exit 1
    printf '%s' deleted > "$STUB_PHASE"
    exit 0
    ;;
  exec)
    [[ "$2" == "$STUB_GATEWAY" ]] || exit 1
    exit 0
    ;;
  *)
    exit 1
    ;;
esac
`;

interface RunOptions {
  acknowledged?: boolean;
  dedicated?: boolean;
  existing?: boolean;
  optIn?: boolean;
  sameAddress?: boolean;
}

function runIntegration(options: RunOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "google-mcp-address-replacement-"));
  dirs.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const stub = join(bin, "container");
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  const log = join(dir, "container.log");
  const phase = join(dir, "phase");
  const target = "google-mcp-address-replacement-test";
  const gateway = "barback-gateway";

  const result = Bun.spawnSync(["bun", "test", "--no-env-file", integrationPath], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      STUB_LOG: log,
      STUB_PHASE: phase,
      STUB_TARGET: target,
      STUB_GATEWAY: gateway,
      STUB_EXISTING: options.existing ? "1" : "0",
      STUB_SAME_ADDRESS: options.sameAddress ? "1" : "0",
      BARBACK_APPLE_CONTAINER_TESTS: options.optIn === false ? "" : "true",
      BARBACK_APPLE_CONTAINER_TESTS_ACKNOWLEDGED: options.acknowledged ? "true" : "",
      BARBACK_APPLE_CONTAINER_TEST_CONTAINER: options.dedicated ? target : "",
      BARBACK_GATEWAY_CONTAINER: gateway,
      BARBACK_CONTAINER_NETWORK: options.dedicated ? "barback-test-net" : "",
      BARBACK_DNS_RESOLVER: options.dedicated ? "192.0.2.53" : "",
      BARBACK_STACK_ID: options.dedicated ? "barback-test" : "",
      GOOGLE_MCP_IMAGE: options.dedicated ? "google-mcp:test" : "",
    },
  });

  return {
    exitCode: result.exitCode,
    stdout: result.stdout.toString(),
    stderr: result.stderr.toString(),
    log: existsSync(log) ? readFileSync(log, "utf8") : "",
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("address replacement integration preflight", () => {
  test("performs no mutation by default", () => {
    const result = runIntegration({ optIn: false, acknowledged: true, dedicated: true });
    expect(result.exitCode).toBe(0);
    expect(result.log).toBe("");
    expect(result.stdout).toContain("set BARBACK_APPLE_CONTAINER_TESTS=true to opt in");
    expect(result.stdout).toContain("No container mutation was performed");
  });

  test("does not mutate the managed google-mcp container without acknowledgement", () => {
    const result = runIntegration({ optIn: true, dedicated: true });
    expect(result.exitCode).toBe(0);
    expect(result.log).toBe("");
    expect(result.stdout).toContain("BARBACK_APPLE_CONTAINER_TESTS_ACKNOWLEDGED=true");
    expect(result.stdout).toContain("No container mutation was performed");
  });

  test("reports missing dedicated identifiers before invoking the container CLI", () => {
    const result = runIntegration({ optIn: true, acknowledged: true });
    expect(result.exitCode).toBe(0);
    expect(result.log).toBe("");
    expect(result.stdout).toContain("BARBACK_APPLE_CONTAINER_TEST_CONTAINER");
    expect(result.stdout).toContain("No container mutation was performed");
  });

  test("refuses an existing dedicated target without lifecycle mutation", () => {
    const result = runIntegration({
      optIn: true,
      acknowledged: true,
      dedicated: true,
      existing: true,
    });
    expect(result.exitCode).toBe(0);
    expect(result.log.split("\n").some((line) => line.startsWith("run "))).toBe(false);
    expect(result.log.split("\n").some((line) => line.startsWith("stop "))).toBe(false);
    expect(result.log.split("\n").some((line) => line.startsWith("delete "))).toBe(false);
    expect(result.stdout).toContain("refusing to mutate existing dedicated test container");
  });

  test("replaces only the dedicated target and requests the canonical FQDN", () => {
    const result = runIntegration({ optIn: true, acknowledged: true, dedicated: true });
    expect(result.exitCode).toBe(0);
    expect(result.log).toContain("run --detach --name google-mcp-address-replacement-test");
    expect(result.log).toContain("http://google.mcp.barback.internal:8090/health");
    expect(result.log).toContain("stop google-mcp-address-replacement-test");
    expect(result.log).toContain("delete google-mcp-address-replacement-test");
    expect(result.log).not.toContain("network create");
  });

  test("cleans up the created target when replacement assertions fail", () => {
    const result = runIntegration({
      optIn: true,
      acknowledged: true,
      dedicated: true,
      sameAddress: true,
    });
    expect(result.exitCode).not.toBe(0);
    const lifecycle = result.log
      .split("\n")
      .filter(
        (line) =>
          line === "stop google-mcp-address-replacement-test" ||
          line === "delete google-mcp-address-replacement-test",
      );
    expect(lifecycle).toEqual([
      "stop google-mcp-address-replacement-test",
      "delete google-mcp-address-replacement-test",
      "stop google-mcp-address-replacement-test",
      "delete google-mcp-address-replacement-test",
    ]);
  });
});
