import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = new URL("../../scripts/start-google-mcp.sh", import.meta.url).pathname;

const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_LOG"
cmd="$1"; shift
case "$cmd" in
  system|stop|delete)
    exit 0
    ;;
  build)
    touch "$STUB_BUILT"
    exit 0
    ;;
  run)
    touch "$STUB_RAN"
    exit 0
    ;;
  inspect)
    exit 1
    ;;
  network)
    exit 0
    ;;
  list)
    echo "[]"
    ;;
  exec)
    if [[ "$STUB_EXEC_FAILS" == "1" ]]; then exit 1; fi
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`;

const dirs: string[] = [];

interface RunOptions {
  network?: string;
  resolver?: string;
  search?: string;
  stack?: string;
  execFails?: boolean;
}

function runScript(options: RunOptions = {}) {
  const dir = mkdtempSync(join(tmpdir(), "google-mcp-start-"));
  dirs.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const stub = join(bin, "container");
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  const log = join(dir, "stub.log");
  const ranFile = join(dir, "ran");
  const builtFile = join(dir, "built");
  const envFile = join(dir, ".env");
  writeFileSync(envFile, "GOOGLE_CLIENT_ID=x\nGOOGLE_REFRESH_TOKEN=y\n");

  const env: Record<string, string> = {
    ...process.env,
    PATH: `${bin}:${process.env.PATH}`,
    STUB_LOG: log,
    STUB_RAN: ranFile,
    STUB_BUILT: builtFile,
    STUB_EXEC_FAILS: options.execFails ? "1" : "0",
    GOOGLE_MCP_ENV_FILE: envFile,
    BARBACK_CONTAINER_NETWORK: options.network === undefined ? "barback" : options.network,
    BARBACK_DNS_RESOLVER: options.resolver === undefined ? "192.0.2.10" : options.resolver,
    BARBACK_DNS_SEARCH: options.search === undefined ? "barback.internal" : options.search,
    BARBACK_STACK_ID: options.stack === undefined ? "barback-local" : options.stack,
    GOOGLE_MCP_READINESS_ATTEMPTS: "2",
  };

  const proc = Bun.spawnSync(["bash", scriptPath], { env: env as Record<string, string> });
  const logText = require("node:fs").existsSync(log) ? readFileSync(log, "utf8") : "";
  return {
    exitCode: proc.exitCode,
    stdout: proc.stdout.toString(),
    stderr: proc.stderr.toString(),
    log: logText,
    built: require("node:fs").existsSync(builtFile),
    ran: require("node:fs").existsSync(ranFile),
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("start-google-mcp.sh managed launch contract", () => {
  test("runs the container with Barback-supplied network, dns, search, and labels", () => {
    const result = runScript({
      network: "barback",
      resolver: "192.0.2.10",
      search: "barback.internal",
      stack: "barback-local",
    });
    expect(result.exitCode).toBe(0);
    expect(result.ran).toBe(true);
    const runLine = result.log.split("\n").find((line) => line.startsWith("run "));
    expect(runLine).toBeDefined();
    expect(runLine).toContain("--network barback");
    expect(runLine).toContain("--dns 192.0.2.10");
    expect(runLine).toContain("--dns-search barback.internal");
    expect(runLine).toContain("--label io.shiborgi.barback.stack=barback-local");
    expect(runLine).toContain("--label io.shiborgi.barback.service=google");
    expect(runLine).toContain("--label io.shiborgi.barback.role=mcp");
  });

  test("never creates a network, publishes a port, or inspects for configuration", () => {
    const result = runScript();
    expect(result.exitCode).toBe(0);
    expect(result.log).not.toContain("network create");
    expect(result.log).not.toContain("--publish");
    const runLine = result.log.split("\n").find((line) => line.startsWith("run "));
    expect(runLine).not.toContain("inspect");
    expect(result.stdout).not.toContain("GOOGLE_MCP_URL=http://192.");
  });

  test("prints the canonical FQDN endpoint and no container IP", () => {
    const result = runScript();
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("GOOGLE_MCP_URL=http://google.mcp.barback.internal:8090/mcp");
    expect(result.stdout).not.toMatch(/container IP/);
  });

  test("fails before building when the network is missing", () => {
    const result = runScript({ network: "" });
    expect(result.exitCode).toBe(1);
    expect(result.built).toBe(false);
    expect(result.ran).toBe(false);
    expect(result.stderr).toContain("BARBACK_CONTAINER_NETWORK");
  });

  test("fails before building when the resolver is missing", () => {
    const result = runScript({ resolver: "" });
    expect(result.exitCode).toBe(1);
    expect(result.built).toBe(false);
    expect(result.stderr).toContain("BARBACK_DNS_RESOLVER");
  });

  test("fails before building when the stack id is empty", () => {
    const result = runScript({ stack: "" });
    expect(result.exitCode).toBe(1);
    expect(result.built).toBe(false);
    expect(result.stderr).toContain("BARBACK_STACK_ID");
  });

  test("keeps the readiness timeout failure path non-zero and actionable", () => {
    const result = runScript({ execFails: true });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("container logs");
  });
});
