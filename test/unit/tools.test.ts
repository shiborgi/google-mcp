import { describe, expect, test } from "bun:test";
import { GoogleAuthError } from "../../src/auth.ts";
import type { GoogleMcpEnv } from "../../src/env.ts";
import { type CalendarClient, GoogleApiError } from "../../src/google-calendar.ts";
import { isTransientError } from "../../src/tools/common.ts";
import { createEvent, getEvent } from "../../src/tools/events.ts";
import { listEvents } from "../../src/tools/list.ts";

const env: GoogleMcpEnv = {
  port: 8090,
  clientId: "id",
  clientSecret: "secret",
  refreshToken: "refresh",
  defaultCalendarId: "primary",
};

describe("calendar tools", () => {
  test("list_events defaults to the configured calendar and expands recurrence", async () => {
    let seenPath = "";
    const client: CalendarClient = {
      async get(
        path: string,
        query: Record<string, string | number | boolean | undefined> | undefined,
      ) {
        seenPath = path;
        expect(query?.singleEvents).toBe(true);
        expect(query?.orderBy).toBe("startTime");
        return { items: [] };
      },
      async post() {},
      async patch() {},
      async delete() {},
    };
    const result = await listEvents(client, env, { timeMin: "2026-08-27T00:00:00-03:00" });
    expect(seenPath).toBe("/calendars/primary/events");
    expect(result.structuredContent).toEqual({ items: [] });
  });

  test("create_event posts the mapped body without invitation emails by default", async () => {
    let seenPath = "";
    let seenBody: unknown;
    const client: CalendarClient = {
      async get() {},
      async post(path: string, body: unknown) {
        seenPath = path;
        seenBody = body;
        return { id: "evt-1", summary: "Planning" };
      },
      async patch() {},
      async delete() {},
    };
    const result = await createEvent(client, env, {
      summary: "Planning",
      start: { dateTime: "2026-08-28T09:00:00-03:00", timeZone: "America/Sao_Paulo" },
      end: { dateTime: "2026-08-28T10:00:00-03:00", timeZone: "America/Sao_Paulo" },
      attendees: [{ email: "carol@example.com", optional: true }],
    });
    expect(seenPath).toBe("/calendars/primary/events?sendUpdates=none");
    expect(seenBody).toEqual({
      summary: "Planning",
      start: { dateTime: "2026-08-28T09:00:00-03:00", timeZone: "America/Sao_Paulo" },
      end: { dateTime: "2026-08-28T10:00:00-03:00", timeZone: "America/Sao_Paulo" },
      attendees: [{ email: "carol@example.com", optional: true }],
    });
    expect((result.structuredContent as { id: string }).id).toBe("evt-1");
  });

  test("get_event projects heavy Google fields out of the response", async () => {
    const client: CalendarClient = {
      async get() {
        return {
          id: "evt-9",
          summary: "Board meeting",
          status: "confirmed",
          htmlLink: "https://example.com/e",
          start: { dateTime: "2026-09-01T09:00:00-03:00" },
          end: { dateTime: "2026-09-01T10:00:00-03:00" },
          attendees: [
            {
              email: "a@example.com",
              displayName: "Ana",
              responseStatus: "accepted",
              organizer: true,
            },
          ],
          extendedProperties: { private: { internal: "x" } },
          gadget: { type: "hangout" },
          attachments: [{ fileUrl: "https://example.com/f" }],
          reminders: { useDefault: true },
          conferenceData: { conferenceId: "abc" },
          source: { url: "https://example.com/s" },
        };
      },
      async post() {},
      async patch() {},
      async delete() {},
    };
    const result = await getEvent(client, env, { eventId: "evt-9" });
    const event = result.structuredContent as Record<string, unknown>;
    expect(event.id).toBe("evt-9");
    expect(event.summary).toBe("Board meeting");
    expect(event.status).toBe("confirmed");
    expect(event.htmlLink).toBe("https://example.com/e");
    expect(event.start).toEqual({ dateTime: "2026-09-01T09:00:00-03:00" });
    expect(event.end).toEqual({ dateTime: "2026-09-01T10:00:00-03:00" });
    expect(event.attendees).toEqual([
      { email: "a@example.com", displayName: "Ana", responseStatus: "accepted" },
    ]);
    expect(event).not.toHaveProperty("extendedProperties");
    expect(event).not.toHaveProperty("gadget");
    expect(event).not.toHaveProperty("attachments");
    expect(event).not.toHaveProperty("reminders");
    expect(event).not.toHaveProperty("conferenceData");
    expect(event).not.toHaveProperty("source");
  });

  test("list_events projects each item, defaults maxResults to 100, and keeps text in sync", async () => {
    let seenMaxResults: number | undefined;
    const client: CalendarClient = {
      async get(_path, query) {
        seenMaxResults = query?.maxResults as number | undefined;
        return {
          items: [
            {
              id: "evt-1",
              summary: "Planning",
              start: { dateTime: "2026-08-28T09:00:00-03:00" },
              end: { dateTime: "2026-08-28T10:00:00-03:00" },
              extendedProperties: { shared: { noisy: "y" } },
              gadget: {},
              reminders: { useDefault: false, overrides: [] },
            },
          ],
          nextPageToken: "tok-2",
        };
      },
      async post() {},
      async patch() {},
      async delete() {},
    };
    const result = await listEvents(client, env, {});
    expect(seenMaxResults).toBe(100);
    expect(result.structuredContent).toEqual({
      items: [
        {
          id: "evt-1",
          summary: "Planning",
          start: { dateTime: "2026-08-28T09:00:00-03:00" },
          end: { dateTime: "2026-08-28T10:00:00-03:00" },
        },
      ],
      nextPageToken: "tok-2",
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toBe(JSON.stringify(result.structuredContent, null, 2));
    expect(text).not.toContain("extendedProperties");

    const overrideClient: CalendarClient = {
      async get(_path, query) {
        seenMaxResults = query?.maxResults as number | undefined;
        return { items: [] };
      },
      async post() {},
      async patch() {},
      async delete() {},
    };
    await listEvents(overrideClient, env, { maxResults: 500 });
    expect(seenMaxResults).toBe(500);
  });

  test("classifies deterministic and transient upstream errors", () => {
    expect(isTransientError(new GoogleApiError("missing", 404))).toBe(false);
    expect(isTransientError(new GoogleApiError("forbidden", 403))).toBe(false);
    expect(isTransientError(new GoogleApiError("quota", 429))).toBe(true);
    expect(isTransientError(new GoogleApiError("unavailable", 500))).toBe(true);
    expect(isTransientError(new GoogleAuthError("invalid refresh token"))).toBe(true);
    expect(isTransientError(new Error("network unavailable"))).toBe(true);
  });
});
