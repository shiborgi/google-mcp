import { z } from "zod";
import type { GoogleMcpEnv } from "../env.ts";
import type { CalendarClient } from "../google-calendar.ts";
import { dateTimeOrDate, toText } from "./common.ts";

const MAX_RESULTS_LIMIT = 250;

export const listCalendarsSchema = {
  maxResults: z
    .number()
    .int()
    .min(1)
    .max(MAX_RESULTS_LIMIT)
    .optional()
    .describe(`Maximum calendars to return, up to ${MAX_RESULTS_LIMIT}`),
  pageToken: z.string().optional().describe("Token from a previous response for pagination"),
  showHidden: z.boolean().optional().describe("Include hidden calendars"),
};

export const listEventsSchema = {
  calendarId: z
    .string()
    .min(1)
    .optional()
    .describe("Calendar ID; defaults to the configured calendar"),
  timeMin: dateTimeOrDate.optional().describe("Lower bound (inclusive) for event start time"),
  timeMax: dateTimeOrDate.optional().describe("Upper bound (exclusive) for event end time"),
  maxResults: z.number().int().min(1).max(2500).optional().describe("Maximum events to return"),
  pageToken: z.string().optional().describe("Token from a previous response for pagination"),
  q: z.string().optional().describe("Free text search terms"),
  singleEvents: z
    .boolean()
    .optional()
    .describe("Expand recurring events into instances; defaults to true"),
};

export async function listCalendars(
  client: CalendarClient,
  args: { maxResults?: number; pageToken?: string; showHidden?: boolean },
) {
  const data = await client.get("/users/me/calendarList", {
    maxResults: args.maxResults,
    pageToken: args.pageToken,
    showHidden: args.showHidden,
  });
  return {
    content: [{ type: "text" as const, text: toText(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

export async function listEvents(
  client: CalendarClient,
  env: GoogleMcpEnv,
  args: {
    calendarId?: string;
    timeMin?: string;
    timeMax?: string;
    maxResults?: number;
    pageToken?: string;
    q?: string;
    singleEvents?: boolean;
  },
) {
  const data = await client.get(
    `/calendars/${encodeURIComponent(args.calendarId ?? env.defaultCalendarId)}/events`,
    {
      timeMin: args.timeMin,
      timeMax: args.timeMax,
      maxResults: args.maxResults,
      pageToken: args.pageToken,
      q: args.q,
      singleEvents: args.singleEvents ?? true,
      orderBy: args.singleEvents === false ? undefined : "startTime",
    },
  );
  return {
    content: [{ type: "text" as const, text: toText(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}
