import { describe, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

const OPT_IN = process.env.BARBACK_APPLE_CONTAINER_TESTS === "true";
const ACKNOWLEDGED = process.env.BARBACK_APPLE_CONTAINER_TESTS_ACKNOWLEDGED === "true";
const CANONICAL_FQDN = "google.mcp.barback.internal";
const OWNER_LABEL = "io.shiborgi.google-mcp.address-replacement-test";

interface ContainerSnapshot {
  id: string;
  running: boolean;
  network: string;
  addresses: string[];
  labels: Record<string, string>;
  publishedPorts: Array<{ containerPort?: number }>;
}

interface TestConfig {
  containerName: string;
  gateway: string;
  network: string;
  resolver: string;
  search: string;
  stackId: string;
  image: string;
  envFile?: string;
  port: string;
}

function container(...args: string[]): string {
  return execFileSync("container", args, { encoding: "utf8" }).trim();
}

function inspect(name: string): ContainerSnapshot | null | undefined {
  try {
    const parsed = JSON.parse(container("inspect", name));
    const item = parsed[0] as
      | {
          id?: string;
          status?: { networks?: Array<{ ipv4Address?: string }>; state?: string };
          configuration?: {
            networks?: Array<{ network?: string }>;
            labels?: Record<string, string>;
            publishedPorts?: Array<{ containerPort?: number }>;
          };
        }
      | undefined;
    if (!item) return null;
    if (!item.id) return undefined;
    return {
      id: item.id,
      running: item.status?.state === "running" || item.status?.state === undefined,
      network: item.configuration?.networks?.[0]?.network ?? "",
      addresses: (item.status?.networks ?? [])
        .map((network) => network.ipv4Address?.split("/")[0])
        .filter((address): address is string => Boolean(address)),
      labels: item.configuration?.labels ?? {},
      publishedPorts: item.configuration?.publishedPorts ?? [],
    };
  } catch {
    return undefined;
  }
}

function listed(name: string): boolean | undefined {
  try {
    const parsed = JSON.parse(container("list", "--format", "json"));
    const items = Array.isArray(parsed) ? parsed : [];
    return items.some((item) => {
      if (!item || typeof item !== "object") return false;
      const candidate = item as Record<string, unknown>;
      return candidate.id === name || candidate.name === name;
    });
  } catch {
    return undefined;
  }
}

function targetExists(name: string): boolean | undefined {
  const snapshot = inspect(name);
  if (snapshot !== undefined) return snapshot !== null;
  return listed(name);
}

function preflight(): { config?: TestConfig; reason?: string } {
  if (!ACKNOWLEDGED) {
    return {
      reason:
        "explicit acknowledgement is required; set BARBACK_APPLE_CONTAINER_TESTS_ACKNOWLEDGED=true",
    };
  }

  const config: TestConfig = {
    containerName: process.env.BARBACK_APPLE_CONTAINER_TEST_CONTAINER ?? "",
    gateway: process.env.BARBACK_GATEWAY_CONTAINER ?? "barback-gateway",
    network: process.env.BARBACK_CONTAINER_NETWORK ?? "",
    resolver: process.env.BARBACK_DNS_RESOLVER ?? "",
    search: process.env.BARBACK_DNS_SEARCH ?? "barback.internal",
    stackId: process.env.BARBACK_STACK_ID ?? "",
    image: process.env.GOOGLE_MCP_IMAGE ?? "",
    envFile: process.env.GOOGLE_MCP_ENV_FILE,
    port: process.env.GOOGLE_MCP_PORT ?? "8090",
  };
  const missing = [
    ["BARBACK_APPLE_CONTAINER_TEST_CONTAINER", config.containerName],
    ["BARBACK_CONTAINER_NETWORK", config.network],
    ["BARBACK_DNS_RESOLVER", config.resolver],
    ["BARBACK_STACK_ID", config.stackId],
    ["GOOGLE_MCP_IMAGE", config.image],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);
  if (missing.length > 0) {
    return { reason: `missing prerequisite(s): ${missing.join(", ")}` };
  }
  if (config.envFile && !existsSync(config.envFile)) {
    return { reason: `environment file does not exist: ${config.envFile}` };
  }
  if (config.containerName === "google-mcp" || config.containerName === config.gateway) {
    return {
      reason: `BARBACK_APPLE_CONTAINER_TEST_CONTAINER must identify a dedicated container, not '${config.containerName}'`,
    };
  }
  return { config };
}

function skip(reason: string): void {
  console.log(
    `Skipping Apple Container address-replacement test: ${reason}. No container mutation was performed.`,
  );
}

function runTestContainer(config: TestConfig): ContainerSnapshot {
  const args = [
    "run",
    "--detach",
    "--name",
    config.containerName,
    "--network",
    config.network,
    "--dns",
    config.resolver,
    "--dns-search",
    config.search,
    "--label",
    `io.shiborgi.barback.stack=${config.stackId}`,
    "--label",
    "io.shiborgi.barback.service=google",
    "--label",
    "io.shiborgi.barback.role=mcp",
    "--label",
    `${OWNER_LABEL}=true`,
  ];
  if (config.envFile) args.push("--env-file", config.envFile);
  args.push("--env", `GOOGLE_MCP_PORT=${config.port}`, config.image);
  container(...args);

  const created = inspect(config.containerName);
  if (!created) {
    throw new Error(`created test container '${config.containerName}' could not be inspected`);
  }
  if (created.labels[OWNER_LABEL] !== "true") {
    throw new Error(`test container '${config.containerName}' is missing its ownership label`);
  }
  return created;
}

function removeCreatedContainer(config: TestConfig, created: ContainerSnapshot): void {
  const current = inspect(config.containerName);
  if (!current || current.id !== created.id || current.labels[OWNER_LABEL] !== "true") return;
  if (current.running) container("stop", config.containerName);
  container("delete", config.containerName);
}

describe("Google MCP address replacement", () => {
  test("recreates a dedicated container and stays reachable through the unchanged FQDN", async () => {
    if (!OPT_IN) {
      skip("set BARBACK_APPLE_CONTAINER_TESTS=true to opt in");
      return;
    }

    const result = preflight();
    if (!result.config) {
      skip(result.reason ?? "prerequisites are unavailable");
      return;
    }
    const config = result.config;

    try {
      container("system", "status");
      container("network", "inspect", config.network);
    } catch {
      skip("Apple Container runtime or the declared Barback network is unavailable");
      return;
    }

    const exists = targetExists(config.containerName);
    if (exists !== false) {
      skip(
        exists === true
          ? `refusing to mutate existing dedicated test container '${config.containerName}'`
          : `could not verify that dedicated test container '${config.containerName}' is absent`,
      );
      return;
    }

    const gateway = inspect(config.gateway);
    if (!gateway?.running) {
      skip(`Barback gateway '${config.gateway}' is unavailable or not running`);
      return;
    }

    const created: ContainerSnapshot[] = [];
    try {
      const first = runTestContainer(config);
      created.push(first);
      const beforeAddress = first.addresses[0];
      expect(beforeAddress).toBeTruthy();

      removeCreatedContainer(config, first);

      const second = runTestContainer(config);
      created.push(second);
      const afterAddress = second.addresses[0];
      expect(afterAddress).toBeTruthy();
      expect(afterAddress).not.toBe(beforeAddress);

      const healthUrl = `http://${CANONICAL_FQDN}:${config.port}/health`;
      const startedAt = performance.now();
      let healthy = false;
      while (performance.now() - startedAt < 15000) {
        try {
          container(
            "exec",
            config.gateway,
            "bun",
            "-e",
            `const response = await fetch('${healthUrl}'); if (!response.ok) process.exit(1);`,
          );
          healthy = true;
          break;
        } catch {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }
      expect(healthy).toBe(true);
      expect(performance.now() - startedAt).toBeLessThan(15000);

      const snapshot = inspect(config.containerName);
      expect(snapshot?.network).toBe(config.network);
      expect(snapshot?.labels["io.shiborgi.barback.stack"]).toBe(config.stackId);
      expect(snapshot?.labels["io.shiborgi.barback.service"]).toBe("google");
      expect(snapshot?.labels["io.shiborgi.barback.role"]).toBe("mcp");
      expect(snapshot?.labels[OWNER_LABEL]).toBe("true");
      expect(snapshot?.publishedPorts.some((port) => port.containerPort === 8090)).toBe(false);
      expect(healthUrl).toContain(`http://${CANONICAL_FQDN}:`);
    } finally {
      for (const resource of created.reverse()) {
        try {
          removeCreatedContainer(config, resource);
        } catch (error) {
          console.error(
            `Warning: failed to clean up dedicated test container '${config.containerName}'`,
            error,
          );
        }
      }
    }
  }, 30000);
});
