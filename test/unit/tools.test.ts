import { describe, expect, test } from "bun:test";
import type { GoogleMcpEnv } from "../../src/env.ts";
import type { CalendarClient } from "../../src/google-calendar.ts";
import { createEvent } from "../../src/tools/events.ts";
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
});
