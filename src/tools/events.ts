import { z } from "zod";
import type { GoogleMcpEnv } from "../env.ts";
import type { CalendarClient } from "../google-calendar.ts";
import {
  attendeeSchema,
  type CalendarEvent,
  eventBody,
  eventRangeError,
  eventTimeSchema,
  projectEvent,
  toText,
  validateEventRange,
} from "./common.ts";

export const getEventSchema = {
  calendarId: z
    .string()
    .min(1)
    .optional()
    .describe("Calendar ID; defaults to the configured calendar"),
  eventId: z.string().min(1).describe("Event ID"),
};

export const createEventSchema = z
  .object({
    calendarId: z
      .string()
      .min(1)
      .optional()
      .describe("Calendar ID; defaults to the configured calendar"),
    summary: z.string().min(1).describe("Event title"),
    description: z.string().optional(),
    location: z.string().optional(),
    start: eventTimeSchema.describe(
      "Event start; use dateTime for timed events or date for all-day",
    ),
    end: eventTimeSchema.describe("Event end"),
    attendees: z.array(attendeeSchema).optional(),
    sendUpdates: z
      .enum(["all", "externalOnly", "none"])
      .optional()
      .describe("Whether to send invitation emails; defaults to none"),
  })
  .superRefine((value, context) => {
    const error = eventRangeError(value.start, value.end);
    if (error) context.addIssue({ code: "custom", path: ["end"], message: error });
  });

export const updateEventSchema = z
  .object({
    calendarId: z
      .string()
      .min(1)
      .optional()
      .describe("Calendar ID; defaults to the configured calendar"),
    eventId: z.string().min(1).describe("Event ID"),
    summary: z.string().min(1).optional(),
    description: z.string().optional(),
    location: z.string().optional(),
    start: eventTimeSchema.optional(),
    end: eventTimeSchema.optional(),
    attendees: z.array(attendeeSchema).optional(),
    sendUpdates: z.enum(["all", "externalOnly", "none"]).optional(),
  })
  .superRefine((value, context) => {
    if (value.start !== undefined && value.end !== undefined) {
      const error = eventRangeError(value.start, value.end);
      if (error) context.addIssue({ code: "custom", path: ["end"], message: error });
    }
  });

export const deleteEventSchema = {
  calendarId: z
    .string()
    .min(1)
    .optional()
    .describe("Calendar ID; defaults to the configured calendar"),
  eventId: z.string().min(1).describe("Event ID"),
  sendUpdates: z.enum(["all", "externalOnly", "none"]).optional(),
};

function calendarPath(env: GoogleMcpEnv, calendarId: string | undefined, suffix = "") {
  return `/calendars/${encodeURIComponent(calendarId ?? env.defaultCalendarId)}${suffix}`;
}

export async function getEvent(
  client: CalendarClient,
  env: GoogleMcpEnv,
  args: { calendarId?: string; eventId: string },
) {
  const data = await client.get(
    calendarPath(env, args.calendarId, `/events/${encodeURIComponent(args.eventId)}`),
  );
  const projected = projectEvent(data as CalendarEvent);
  return {
    content: [{ type: "text" as const, text: toText(projected) }],
    structuredContent: projected as Record<string, unknown>,
  };
}

export async function createEvent(
  client: CalendarClient,
  env: GoogleMcpEnv,
  args: {
    calendarId?: string;
    summary: string;
    description?: string;
    location?: string;
    start: { dateTime?: string; date?: string; timeZone?: string };
    end: { dateTime?: string; date?: string; timeZone?: string };
    attendees?: { email: string; displayName?: string; optional?: boolean }[];
    sendUpdates?: "all" | "externalOnly" | "none";
  },
) {
  const start = eventTimeSchema.parse(args.start);
  const end = eventTimeSchema.parse(args.end);
  validateEventRange(start, end);
  const path = calendarPath(env, args.calendarId, "/events");
  const urlQuery = args.sendUpdates ? `?sendUpdates=${args.sendUpdates}` : "?sendUpdates=none";
  const data = await client.post(`${path}${urlQuery}`, eventBody({ ...args, start, end }));
  return {
    content: [{ type: "text" as const, text: toText(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

export async function updateEvent(
  client: CalendarClient,
  env: GoogleMcpEnv,
  args: {
    calendarId?: string;
    eventId: string;
    summary?: string;
    description?: string;
    location?: string;
    start?: { dateTime?: string; date?: string; timeZone?: string };
    end?: { dateTime?: string; date?: string; timeZone?: string };
    attendees?: { email: string; displayName?: string; optional?: boolean }[];
    sendUpdates?: "all" | "externalOnly" | "none";
  },
) {
  const start = args.start === undefined ? undefined : eventTimeSchema.parse(args.start);
  const end = args.end === undefined ? undefined : eventTimeSchema.parse(args.end);
  if (start !== undefined && end !== undefined) validateEventRange(start, end);
  const path = calendarPath(env, args.calendarId, `/events/${encodeURIComponent(args.eventId)}`);
  const urlQuery = args.sendUpdates ? `?sendUpdates=${args.sendUpdates}` : "?sendUpdates=none";
  const data = await client.patch(`${path}${urlQuery}`, eventBody({ ...args, start, end }));
  return {
    content: [{ type: "text" as const, text: toText(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

export async function deleteEvent(
  client: CalendarClient,
  env: GoogleMcpEnv,
  args: { calendarId?: string; eventId: string; sendUpdates?: "all" | "externalOnly" | "none" },
) {
  const path = calendarPath(env, args.calendarId, `/events/${encodeURIComponent(args.eventId)}`);
  const urlQuery = args.sendUpdates ? `?sendUpdates=${args.sendUpdates}` : "?sendUpdates=none";
  await client.delete(`${path}${urlQuery}`);
  const data = {
    deleted: true,
    eventId: args.eventId,
    calendarId: args.calendarId ?? env.defaultCalendarId,
  };
  return {
    content: [{ type: "text" as const, text: toText(data) }],
    structuredContent: data,
  };
}
