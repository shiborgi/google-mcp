import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const scriptPath = new URL("../../scripts/start-google-mcp.sh", import.meta.url).pathname;

const STUB = `#!/usr/bin/env bash
printf '%s\\n' "$*" >> "$STUB_LOG"
cmd="$1"; shift
case "$cmd" in
  system|network|build|stop|delete)
    exit 0
    ;;
  run)
    touch "$STUB_RAN"
    exit 0
    ;;
  inspect)
    name="$1"
    if [[ "$name" == "google-mcp" && -f "$STUB_RAN" ]]; then
      printf '%s' "$STUB_IP_JSON"
      exit 0
    fi
    exit 1
    ;;
  list)
    echo "[]"
    ;;
  exec)
    exit 0
    ;;
  *)
    exit 0
    ;;
esac
`;

const dirs: string[] = [];

function runScript(ipJson: string, port = "8090") {
  const dir = mkdtempSync(join(tmpdir(), "google-mcp-start-"));
  dirs.push(dir);
  const bin = join(dir, "bin");
  mkdirSync(bin);
  const stub = join(bin, "container");
  writeFileSync(stub, STUB);
  chmodSync(stub, 0o755);
  const log = join(dir, "stub.log");
  const envFile = join(dir, ".env");
  writeFileSync(envFile, "GOOGLE_CLIENT_ID=x\nGOOGLE_REFRESH_TOKEN=y\n");

  const proc = Bun.spawnSync(["bash", scriptPath], {
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      STUB_LOG: log,
      STUB_RAN: join(dir, "ran"),
      STUB_IP_JSON: ipJson,
      GOOGLE_MCP_ENV_FILE: envFile,
      GOOGLE_MCP_PORT: port,
    },
  });
  return { proc, log: readFileSync(log, "utf8") };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("start-google-mcp.sh IP output", () => {
  test("prints the resolved IP and the Barback-ready URL after the health loop", () => {
    const { proc } = runScript('[{"status":{"networks":[{"ipv4Address":"192.168.64.20/24"}]}}]');
    expect(proc.exitCode).toBe(0);
    const out = proc.stdout.toString();
    expect(out).toContain("google-mcp container IP: 192.168.64.20");
    expect(out).toContain("GOOGLE_MCP_URL=http://192.168.64.20:8090/mcp");
  });

  test("prints a warning without a non-zero exit when the IP cannot be resolved", () => {
    const { proc } = runScript('[{"status":{"networks":[{}]}}]');
    expect(proc.exitCode).toBe(0);
    const err = proc.stderr.toString();
    expect(err).toContain("Warning: could not resolve the google-mcp container IP");
  });
});
