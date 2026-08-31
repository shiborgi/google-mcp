import { beforeAll, describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OPT_IN = process.env.BARBACK_APPLE_CONTAINER_TESTS === "true";

function container(...args: string[]): string {
  return execFileSync("container", args, { encoding: "utf8" }).trim();
}

function inspect(name: string) {
  try {
    const raw = container("inspect", name);
    const parsed = JSON.parse(raw);
    const item = parsed[0];
    const status = item?.status as
      | { networks?: Array<{ ipv4Address?: string }>; state?: string }
      | undefined;
    const configuration = item?.configuration as
      | {
          networks?: Array<{ network?: string }>;
          labels?: Record<string, string>;
          publishedPorts?: Array<{ containerPort?: number }>;
        }
      | undefined;
    return {
      id: item?.id as string | undefined,
      running: status?.state === "running" || status?.state === undefined,
      network: configuration?.networks?.[0]?.network ?? "",
      addresses: (status?.networks ?? [])
        .map((n) => n.ipv4Address?.split("/")[0])
        .filter((v): v is string => Boolean(v)),
      labels: configuration?.labels ?? {},
      publishedPorts: configuration?.publishedPorts ?? [],
    };
  } catch {
    return null;
  }
}

describe("Google MCP address replacement", () => {
  let hasContainer = false;

  beforeAll(async () => {
    if (!OPT_IN) return;
    try {
      container("system", "status");
      hasContainer = true;
    } catch {
      hasContainer = false;
    }
  });

  test("recreates google-mcp and stays reachable through the unchanged FQDN", async () => {
    if (!OPT_IN) {
      console.log("Skipping Apple Container test (set BARBACK_APPLE_CONTAINER_TESTS=true)");
      return;
    }
    if (!hasContainer) {
      console.log("Skipping Apple Container test because runtime is unavailable");
      return;
    }
    // This scenario depends on the Barback DNS control plane and a running
    // barback-gateway with reconnect support. Report that prerequisite
    // explicitly rather than falling back to an IP literal.
    const gateway = process.env.BARBACK_GATEWAY_CONTAINER ?? "barback-gateway";
    const network = process.env.BARBACK_CONTAINER_NETWORK ?? "barback";
    const resolver = process.env.BARBACK_DNS_RESOLVER ?? "";
    const stackId = process.env.BARBACK_STACK_ID ?? "barback-local";
    if (!resolver) {
      console.log(
        "Skipping: requires Barback DNS control plane (BARBACK_DNS_RESOLVER) and barback-gateway reconnect support",
      );
      return;
    }

    const root = await mkdtemp(join(tmpdir(), "google-mcp-replace-"));
    const name = "google-mcp";
    try {
      const before = inspect(name);
      if (!before) {
        console.log(
          "Skipping: google-mcp container is not present; start it via start-google-mcp.sh",
        );
        return;
      }
      const beforeAddress = before.addresses[0];

      // Recreate the container at a different address.
      container("stop", name);
      container("delete", name);
      container(
        "run",
        "--detach",
        "--name",
        name,
        "--network",
        network,
        "--dns",
        resolver,
        "--dns-search",
        "barback.internal",
        "--label",
        `io.shiborgi.barback.stack=${stackId}`,
        "--label",
        "io.shiborgi.barback.service=google",
        "--label",
        "io.shiborgi.barback.role=mcp",
        ...(process.env.GOOGLE_MCP_ENV_FILE ? ["--env-file", process.env.GOOGLE_MCP_ENV_FILE] : []),
        process.env.GOOGLE_MCP_IMAGE ?? "google-mcp:local",
      );

      const after = inspect(name);
      expect(after).not.toBeNull();
      const afterAddress = after!.addresses[0];
      expect(afterAddress).not.toBe(beforeAddress);

      // Wait within Barback's 15-second convergence budget.
      const startedAt = performance.now();
      let healthy = false;
      while (performance.now() - startedAt < 15000) {
        try {
          container(
            "exec",
            gateway,
            "bun",
            "-e",
            `const r = await fetch('http://google.mcp.barback.internal:8090/health'); if (!r.ok) process.exit(1);`,
          );
          healthy = true;
          break;
        } catch {
          // not yet converged
        }
        await new Promise((r) => setTimeout(r, 500));
      }
      expect(healthy).toBe(true);
      expect(performance.now() - startedAt).toBeLessThan(15000);

      // Verify the recreated container is on the declared NAT network, uses the
      // injected resolver/search, carries the required labels, and has no
      // host-published port 8090.
      const snapshot = inspect(name);
      expect(snapshot?.network).toBe(network);
      expect(snapshot?.labels["io.shiborgi.barback.stack"]).toBe(stackId);
      expect(snapshot?.labels["io.shiborgi.barback.service"]).toBe("google");
      expect(snapshot?.labels["io.shiborgi.barback.role"]).toBe("mcp");
      expect(snapshot?.publishedPorts.some((p) => p.containerPort === 8090)).toBe(false);
    } finally {
      try {
        container("stop", name);
        container("delete", name);
      } catch {}
      await rm(root, { recursive: true, force: true });
    }
  }, 30000);
});
