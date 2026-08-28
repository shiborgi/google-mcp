import { z } from "zod";
import { GoogleAuthError } from "../auth.ts";
import { GoogleApiError } from "../google-calendar.ts";

export const dateTimeOrDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?)?$/)
  .describe("RFC3339 datetime (e.g. 2026-08-27T09:00:00-03:00) or a full-day date (YYYY-MM-DD)");

export const attendeeSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  optional: z.boolean().optional(),
});

export const eventTimeSchema = z.object({
  dateTime: dateTimeOrDate.optional(),
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  timeZone: z.string().optional(),
});

export interface CalendarEvent {
  id?: string;
  status?: string;
  htmlLink?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  attendees?: { email?: string; displayName?: string; responseStatus?: string }[];
  creator?: { email?: string; displayName?: string };
  organizer?: { email?: string; displayName?: string };
  updated?: string;
  created?: string;
}

export interface CalendarListEntry {
  id?: string;
  summary?: string;
  description?: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
}

export function toText(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function errorText(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function isTransientError(error: unknown): boolean {
  if (error instanceof GoogleAuthError) return true;
  if (error instanceof GoogleApiError) return error.status === 429 || error.status >= 500;
  return true;
}

export function eventBody(input: {
  summary?: string;
  description?: string;
  location?: string;
  start?: z.infer<typeof eventTimeSchema>;
  end?: z.infer<typeof eventTimeSchema>;
  attendees?: z.infer<typeof attendeeSchema>[];
}) {
  const body: Record<string, unknown> = {};
  if (input.summary !== undefined) body.summary = input.summary;
  if (input.description !== undefined) body.description = input.description;
  if (input.location !== undefined) body.location = input.location;
  if (input.start)
    body.start = input.start.date
      ? { date: input.start.date, timeZone: input.start.timeZone }
      : { dateTime: input.start.dateTime, timeZone: input.start.timeZone };
  if (input.end)
    body.end = input.end.date
      ? { date: input.end.date, timeZone: input.end.timeZone }
      : { dateTime: input.end.dateTime, timeZone: input.end.timeZone };
  if (input.attendees) body.attendees = input.attendees;
  return body;
}
