import { z } from "zod";
import type { GoogleMcpEnv } from "../env.ts";
import type { CalendarClient } from "../google-calendar.ts";
import { calendarRangeError, dateTimeOrDate, toText, validateCalendarRange } from "./common.ts";

export const freeBusySchema = z
  .object({
    timeMin: dateTimeOrDate.describe("Start of the interval (inclusive), RFC3339"),
    timeMax: dateTimeOrDate.describe("End of the interval (exclusive), RFC3339"),
    calendarIds: z
      .array(z.string().min(1))
      .min(1)
      .optional()
      .describe("Calendars to query; defaults to the configured calendar"),
    timeZone: z.string().optional().describe("IANA time zone, e.g. America/Sao_Paulo"),
  })
  .superRefine((value, context) => {
    const error = calendarRangeError(value.timeMin, value.timeMax);
    if (error) context.addIssue({ code: "custom", path: ["timeMax"], message: error });
  });

export const quickAddSchema = {
  calendarId: z
    .string()
    .min(1)
    .optional()
    .describe("Calendar ID; defaults to the configured calendar"),
  text: z
    .string()
    .min(1)
    .describe("Natural language event text, e.g. 'Lunch with Carol tomorrow at noon'"),
  sendUpdates: z.enum(["all", "externalOnly", "none"]).optional(),
};

export async function freeBusy(
  client: CalendarClient,
  env: GoogleMcpEnv,
  args: { timeMin: string; timeMax: string; calendarIds?: string[]; timeZone?: string },
) {
  validateCalendarRange(args.timeMin, args.timeMax);
  const data = await client.post("/freeBusy", {
    timeMin: args.timeMin,
    timeMax: args.timeMax,
    timeZone: args.timeZone,
    items: (args.calendarIds ?? [env.defaultCalendarId]).map((id) => ({ id })),
  });
  return {
    content: [{ type: "text" as const, text: toText(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}

export async function quickAdd(
  client: CalendarClient,
  env: GoogleMcpEnv,
  args: { calendarId?: string; text: string; sendUpdates?: "all" | "externalOnly" | "none" },
) {
  const calendar = encodeURIComponent(args.calendarId ?? env.defaultCalendarId);
  const query = new URLSearchParams({ text: args.text, sendUpdates: args.sendUpdates ?? "none" });
  const data = await client.post(`/calendars/${calendar}/events/quickAdd?${query}`, {});
  return {
    content: [{ type: "text" as const, text: toText(data) }],
    structuredContent: data as Record<string, unknown>,
  };
}
