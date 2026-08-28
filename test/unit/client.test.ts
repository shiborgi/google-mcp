import { describe, expect, test } from "bun:test";
import type { TokenBroker } from "../../src/auth.ts";
import { GoogleCalendarClient } from "../../src/google-calendar.ts";

const tokens: TokenBroker = { accessToken: async () => "ya29.token" };
const noDelay = async (_milliseconds: number) => {};

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("GoogleCalendarClient", () => {
  test("sends bearer token, encodes paths, and parses JSON", async () => {
    let seen: { url: string; auth: string | null; method: string } | undefined;
    const fetcher = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      seen = {
        url,
        auth: new Headers(init?.headers).get("authorization"),
        method: init?.method ?? "GET",
      };
      return jsonResponse({ items: [{ id: "primary" }] });
    }) as unknown as typeof fetch;
    const client = new GoogleCalendarClient(tokens, fetcher);
    const data = await client.get("/calendars/my calendar/events", { maxResults: 5 });
    expect((data as { items: unknown[] }).items).toHaveLength(1);
    expect(seen?.auth).toBe("Bearer ya29.token");
    expect(seen?.method).toBe("GET");
    expect(seen?.url).toBe(
      "https://www.googleapis.com/calendar/v3/calendars/my%20calendar/events?maxResults=5",
    );
  });

  test("raises GoogleApiError with status on failures", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response("quota exceeded", { status: 429 });
    }) as unknown as typeof fetch;
    const client = new GoogleCalendarClient(tokens, fetcher, undefined, noDelay);
    await expect(client.get("/users/me/calendarList")).rejects.toMatchObject({
      name: "GoogleApiError",
      status: 429,
    });
    expect(calls).toBe(3);
  });

  test("retries a 429 and succeeds", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return calls === 1 ? new Response("quota", { status: 429 }) : jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const client = new GoogleCalendarClient(tokens, fetcher, undefined, noDelay);

    await expect(client.get("/users/me/calendarList")).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test("retries a 500 and succeeds", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return calls === 1
        ? new Response("server error", { status: 500 })
        : jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const client = new GoogleCalendarClient(tokens, fetcher, undefined, noDelay);

    await expect(client.get("/users/me/calendarList")).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test("retries a network failure and succeeds", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      if (calls === 1) throw new TypeError("network unavailable");
      return jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const client = new GoogleCalendarClient(tokens, fetcher, undefined, noDelay);

    await expect(client.get("/users/me/calendarList")).resolves.toEqual({ ok: true });
    expect(calls).toBe(2);
  });

  test("exhausts transient response retries and preserves the final status", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response("unavailable", { status: 503 });
    }) as unknown as typeof fetch;
    const client = new GoogleCalendarClient(tokens, fetcher, undefined, noDelay);

    await expect(client.get("/users/me/calendarList")).rejects.toMatchObject({
      name: "GoogleApiError",
      status: 503,
    });
    expect(calls).toBe(3);
  });

  test("does not retry a deterministic 404", async () => {
    let calls = 0;
    const fetcher = (async () => {
      calls += 1;
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    const client = new GoogleCalendarClient(tokens, fetcher, undefined, noDelay);

    await expect(client.get("/users/me/calendarList")).rejects.toMatchObject({
      name: "GoogleApiError",
      status: 404,
    });
    expect(calls).toBe(1);
  });

  test("honors Retry-After while keeping exponential delays bounded", async () => {
    let calls = 0;
    const delays: number[] = [];
    const delay = async (milliseconds: number) => {
      delays.push(milliseconds);
    };
    const fetcher = (async () => {
      calls += 1;
      return calls === 1
        ? new Response("quota", { status: 429, headers: { "retry-after": "3" } })
        : jsonResponse({ ok: true });
    }) as unknown as typeof fetch;
    const client = new GoogleCalendarClient(tokens, fetcher, undefined, delay);

    await expect(client.get("/users/me/calendarList")).resolves.toEqual({ ok: true });
    expect(delays).toEqual([3000]);

    const failingFetcher = (async () =>
      new Response("unavailable", { status: 503 })) as unknown as typeof fetch;
    const failingDelays: number[] = [];
    const failingClient = new GoogleCalendarClient(
      tokens,
      failingFetcher,
      undefined,
      async (ms) => {
        failingDelays.push(ms);
      },
    );
    await expect(failingClient.get("/users/me/calendarList")).rejects.toMatchObject({
      status: 503,
    });
    expect(failingDelays).toHaveLength(2);
    expect(failingDelays[0]).toBeGreaterThanOrEqual(187);
    expect(failingDelays[0]).toBeLessThanOrEqual(313);
    expect(failingDelays[1]).toBeGreaterThanOrEqual(375);
    expect(failingDelays[1]).toBeLessThanOrEqual(625);
    expect(failingDelays.reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(15_000);
  });

  test("delete resolves on 204", async () => {
    const fetcher = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const client = new GoogleCalendarClient(tokens, fetcher);
    await expect(client.delete("/calendars/primary/events/abc")).resolves.toBeUndefined();
  });
});
