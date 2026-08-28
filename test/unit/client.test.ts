import { describe, expect, test } from "bun:test";
import type { TokenBroker } from "../../src/auth.ts";
import { GoogleCalendarClient } from "../../src/google-calendar.ts";

const tokens: TokenBroker = { accessToken: async () => "ya29.token" };

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
    const fetcher = (async () =>
      new Response("quota exceeded", { status: 429 })) as unknown as typeof fetch;
    const client = new GoogleCalendarClient(tokens, fetcher);
    await expect(client.get("/users/me/calendarList")).rejects.toMatchObject({
      name: "GoogleApiError",
      status: 429,
    });
  });

  test("delete resolves on 204", async () => {
    const fetcher = (async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
    const client = new GoogleCalendarClient(tokens, fetcher);
    await expect(client.delete("/calendars/primary/events/abc")).resolves.toBeUndefined();
  });
});
