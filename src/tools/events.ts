import { z } from "zod";
import type { GoogleMcpEnv } from "../env.ts";
import type { CalendarClient } from "../google-calendar.ts";
import { attendeeSchema, eventBody, eventTimeSchema, toText } from "./common.ts";

export const getEventSchema = {
  calendarId: z
    .string()
    .min(1)
    .optional()
    .describe("Calendar ID; defaults to the configured calendar"),
  eventId: z.string().min(1).describe("Event ID"),
};

export const createEventSchema = {
  calendarId: z
    .string()
    .min(1)
    .optional()
    .describe("Calendar ID; defaults to the configured calendar"),
  summary: z.string().min(1).describe("Event title"),
  description: z.string().optional(),
  location: z.string().optional(),
  start: eventTimeSchema.describe("Event start; use dateTime for timed events or date for all-day"),
  end: eventTimeSchema.describe("Event end"),
  attendees: z.array(attendeeSchema).optional(),
  sendUpdates: z
    .enum(["all", "externalOnly", "none"])
    .optional()
    .describe("Whether to send invitation emails; defaults to none"),
};

export const updateEventSchema = {
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
};

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
  return {
    content: [{ type: "text" as const, text: toText(data) }],
    structuredContent: data as Record<string, unknown>,
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
  const path = calendarPath(env, args.calendarId, "/events");
  const urlQuery = args.sendUpdates ? `?sendUpdates=${args.sendUpdates}` : "?sendUpdates=none";
  const data = await client.post(`${path}${urlQuery}`, eventBody(args));
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
  const path = calendarPath(env, args.calendarId, `/events/${encodeURIComponent(args.eventId)}`);
  const urlQuery = args.sendUpdates ? `?sendUpdates=${args.sendUpdates}` : "?sendUpdates=none";
  const data = await client.patch(`${path}${urlQuery}`, eventBody(args));
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
