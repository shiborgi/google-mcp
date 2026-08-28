import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { GoogleMcpEnv } from "./env.ts";
import type { CalendarClient } from "./google-calendar.ts";
import { errorText } from "./tools/common.ts";
import {
  createEvent,
  createEventSchema,
  deleteEvent,
  deleteEventSchema,
  getEvent,
  getEventSchema,
  updateEvent,
  updateEventSchema,
} from "./tools/events.ts";
import { freeBusy, freeBusySchema, quickAdd, quickAddSchema } from "./tools/extras.ts";
import { listCalendars, listCalendarsSchema, listEvents, listEventsSchema } from "./tools/list.ts";

export const SERVER_NAME = "google-mcp";
export const SERVER_VERSION = "0.1.0";

function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  return fn().catch((error: unknown) => ({
    isError: true,
    content: [{ type: "text" as const, text: errorText(error) }],
  }));
}

export function createServer(client: CalendarClient, env: GoogleMcpEnv): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: false } } },
  );

  server.registerTool(
    "list_calendars",
    {
      description: "List calendars visible to the authenticated Google account",
      inputSchema: listCalendarsSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => guard(() => listCalendars(client, args)),
  );

  server.registerTool(
    "list_events",
    {
      description: "List events on a calendar within an optional time range",
      inputSchema: listEventsSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => guard(() => listEvents(client, env, args)),
  );

  server.registerTool(
    "get_event",
    {
      description: "Fetch one event by ID",
      inputSchema: getEventSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => guard(() => getEvent(client, env, args)),
  );

  server.registerTool(
    "create_event",
    {
      description: "Create a calendar event",
      inputSchema: createEventSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (args) => guard(() => createEvent(client, env, args)),
  );

  server.registerTool(
    "update_event",
    {
      description: "Patch selected fields of an existing event",
      inputSchema: updateEventSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    (args) => guard(() => updateEvent(client, env, args)),
  );

  server.registerTool(
    "delete_event",
    {
      description: "Delete an event by ID",
      inputSchema: deleteEventSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => guard(() => deleteEvent(client, env, args)),
  );

  server.registerTool(
    "free_busy",
    {
      description: "Query busy intervals for one or more calendars",
      inputSchema: freeBusySchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => guard(() => freeBusy(client, env, args)),
  );

  server.registerTool(
    "quick_add",
    {
      description: "Create an event from natural language text (Google quickAdd)",
      inputSchema: quickAddSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (args) => guard(() => quickAdd(client, env, args)),
  );

  return server;
}
