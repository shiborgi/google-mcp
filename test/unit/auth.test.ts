import { describe, expect, test } from "bun:test";
import { RefreshTokenBroker } from "../../src/auth.ts";

function tokenResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("RefreshTokenBroker", () => {
  test("exchanges the refresh token and caches until expiry", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return tokenResponse({ access_token: "ya29.token", expires_in: 3600 });
    }) as unknown as typeof fetch;
    const broker = new RefreshTokenBroker("id", "secret", "refresh", fetcher);
    expect(await broker.accessToken()).toBe("ya29.token");
    expect(await broker.accessToken()).toBe("ya29.token");
    expect(calls).toBe(1);
  });

  test("fails with context when Google rejects the refresh", async () => {
    const fetcher = (async () =>
      tokenResponse({ error: "invalid_grant" }, 400)) as unknown as typeof fetch;
    const broker = new RefreshTokenBroker("id", "secret", "refresh", fetcher);
    await expect(broker.accessToken()).rejects.toThrow("HTTP 400");
  });
});
