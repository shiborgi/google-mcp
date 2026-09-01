import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Subprocess } from "bun";

function waitForUrl(url: string, attempts = 50): Promise<void> {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const res = await fetch(url);
        if (res.ok) return resolve();
      } catch {}
      if (--attempts <= 0) return reject(new Error(`Server did not start at ${url}`));
      setTimeout(tick, 100);
    };
    void tick();
  });
}

const env = {
  GOOGLE_MCP_PORT: "8095",
  GOOGLE_MCP_TOKEN: "contract-token",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  GOOGLE_REFRESH_TOKEN: "refresh",
  GOOGLE_MCP_SKIP_TOKEN_CHECK: "1",
};

describe("HTTP transport", () => {
  let proc: Subprocess | undefined;
  const base = "http://127.0.0.1:8095";

  beforeAll(async () => {
    proc = Bun.spawn(["bun", "run", "src/index.ts"], {
      cwd: new URL("../..", import.meta.url).pathname,
      env: { ...process.env, ...env },
      stdout: "ignore",
      stderr: "inherit",
    });
    await waitForUrl(`${base}/health`);
  });

  afterAll(() => {
    proc?.kill();
  });

  test("answers health probes without authentication", async () => {
    const health = await fetch(`${base}/health`);
    expect(health.status).toBe(200);
    const body = (await health.json()) as { status: string; server: string };
    expect(body.status).toBe("ready");
    expect(body.server).toBe("google-mcp");

    const live = await fetch(`${base}/health/live`);
    expect(live.status).toBe(200);
  });

  test("rejects unauthenticated MCP traffic when a token is configured", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(res.status).toBe(401);
  });

  test("requires a strict bearer header without echoing credentials", async () => {
    const headers = {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    };
    const invalidHeaders: Record<string, string>[] = [
      headers,
      { ...headers, authorization: "bearer contract-token" },
      { ...headers, authorization: "Bearer  contract-token" },
      { ...headers, authorization: "Bearer contract-token," },
      { ...headers, authorization: "Basic contract-token" },
      { ...headers, authorization: "Bearer wrong-length-token" },
    ];

    for (const requestHeaders of invalidHeaders) {
      const res = await fetch(`${base}/mcp`, {
        method: "POST",
        headers: requestHeaders,
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(res.status).toBe(401);
      expect(await res.text()).not.toContain("contract-token");
    }
  });

  test("initialize negotiates a protocol version for authorized clients", async () => {
    const res = await fetch(`${base}/mcp`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: "Bearer contract-token",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "contract", version: "0.0.0" },
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      result: { serverInfo: { name: string }; capabilities: { tools?: unknown } };
    };
    expect(body.result.serverInfo.name).toBe("google-mcp");
    expect(body.result.capabilities.tools).toBeDefined();
  });
});
