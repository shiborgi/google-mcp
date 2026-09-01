import { z } from "zod";
import { GoogleAuthError } from "../auth.ts";
import { GoogleApiError } from "../google-calendar.ts";

const calendarDate = z.iso.date();
const calendarDateTime = z.iso.datetime({ offset: true });

export const dateTimeOrDate = z
  .union([calendarDateTime, calendarDate])
  .describe("RFC3339 datetime (e.g. 2026-08-27T09:00:00-03:00) or a full-day date (YYYY-MM-DD)");

export const attendeeSchema = z.object({
  email: z.string().email(),
  displayName: z.string().optional(),
  optional: z.boolean().optional(),
});

export const eventTimeSchema = z
  .object({
    dateTime: calendarDateTime.optional(),
    date: calendarDate.optional(),
    timeZone: z.string().optional(),
  })
  .superRefine((value, context) => {
    if ((value.date === undefined) === (value.dateTime === undefined)) {
      context.addIssue({
        code: "custom",
        path: ["dateTime"],
        message: "Provide exactly one of date or dateTime",
      });
    }
  });

export type CalendarEventTime = z.infer<typeof eventTimeSchema>;

export function eventRangeError(
  start: CalendarEventTime,
  end: CalendarEventTime,
): string | undefined {
  const startIsDate = start.date !== undefined;
  const endIsDate = end.date !== undefined;
  const startHasTime = start.dateTime !== undefined;
  const endHasTime = end.dateTime !== undefined;

  if (startIsDate === startHasTime || endIsDate === endHasTime) {
    return "Event times must provide exactly one of date or dateTime";
  }
  if (startIsDate !== endIsDate) {
    return "Event start and end must use the same date or dateTime form";
  }

  const startValue = start.date ?? start.dateTime;
  const endValue = end.date ?? end.dateTime;
  if (startValue === undefined || endValue === undefined) {
    return "Event times must provide exactly one of date or dateTime";
  }
  if (startIsDate) {
    return endValue > startValue ? undefined : "Event end must be after event start";
  }

  const startMilliseconds = Date.parse(startValue);
  const endMilliseconds = Date.parse(endValue);
  return endMilliseconds > startMilliseconds ? undefined : "Event end must be after event start";
}

export function validateEventRange(start: unknown, end: unknown): void {
  const parsedStart = eventTimeSchema.parse(start);
  const parsedEnd = eventTimeSchema.parse(end);
  const error = eventRangeError(parsedStart, parsedEnd);
  if (error) throw new Error(error);
}

export function calendarRangeError(start: string, end: string): string | undefined {
  const startIsDate = !start.includes("T");
  const endIsDate = !end.includes("T");
  if (startIsDate !== endIsDate) return "Range bounds must use the same date or dateTime form";

  if (startIsDate) return end > start ? undefined : "Range end must be after range start";

  const startMilliseconds = Date.parse(start);
  const endMilliseconds = Date.parse(end);
  return endMilliseconds > startMilliseconds ? undefined : "Range end must be after range start";
}

export function validateCalendarRange(start: unknown, end: unknown): void {
  const parsedStart = dateTimeOrDate.parse(start);
  const parsedEnd = dateTimeOrDate.parse(end);
  const error = calendarRangeError(parsedStart, parsedEnd);
  if (error) throw new Error(error);
}

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
  recurrence?: string[];
  updated?: string;
  created?: string;
}

export function projectEvent(event: CalendarEvent): CalendarEvent {
  const projected: CalendarEvent = {};
  if (event.id !== undefined) projected.id = event.id;
  if (event.status !== undefined) projected.status = event.status;
  if (event.htmlLink !== undefined) projected.htmlLink = event.htmlLink;
  if (event.summary !== undefined) projected.summary = event.summary;
  if (event.description !== undefined) projected.description = event.description;
  if (event.location !== undefined) projected.location = event.location;
  if (event.start !== undefined) projected.start = event.start;
  if (event.end !== undefined) projected.end = event.end;
  if (event.attendees !== undefined) {
    projected.attendees = event.attendees.map((attendee) => ({
      ...(attendee.email !== undefined ? { email: attendee.email } : {}),
      ...(attendee.displayName !== undefined ? { displayName: attendee.displayName } : {}),
      ...(attendee.responseStatus !== undefined ? { responseStatus: attendee.responseStatus } : {}),
    }));
  }
  if (event.creator !== undefined) projected.creator = event.creator;
  if (event.organizer !== undefined) projected.organizer = event.organizer;
  if (event.recurrence !== undefined) projected.recurrence = event.recurrence;
  if (event.updated !== undefined) projected.updated = event.updated;
  return projected;
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
