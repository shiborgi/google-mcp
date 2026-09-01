import { z } from "zod";
import type { GoogleMcpEnv } from "../env.ts";
import type { CalendarClient } from "../google-calendar.ts";
import {
  type CalendarEvent,
  calendarRangeError,
  dateTimeOrDate,
  projectEvent,
  toText,
  validateCalendarRange,
} from "./common.ts";

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

export const listEventsSchema = z
  .object({
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
  })
  .superRefine((value, context) => {
    if (value.timeMin !== undefined && value.timeMax !== undefined) {
      const error = calendarRangeError(value.timeMin, value.timeMax);
      if (error) context.addIssue({ code: "custom", path: ["timeMax"], message: error });
    }
  });

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
  if (args.timeMin !== undefined && args.timeMax !== undefined) {
    validateCalendarRange(args.timeMin, args.timeMax);
  }
  const data = await client.get(
    `/calendars/${encodeURIComponent(args.calendarId ?? env.defaultCalendarId)}/events`,
    {
      timeMin: args.timeMin,
      timeMax: args.timeMax,
      maxResults: args.maxResults ?? 100,
      pageToken: args.pageToken,
      q: args.q,
      singleEvents: args.singleEvents ?? true,
      orderBy: args.singleEvents === false ? undefined : "startTime",
    },
  );
  const page = data as { items?: CalendarEvent[]; nextPageToken?: string };
  const projected: Record<string, unknown> = {
    ...page,
    items: (page.items ?? []).map(projectEvent),
  };
  return {
    content: [{ type: "text" as const, text: toText(projected) }],
    structuredContent: projected,
  };
}
