import type { RegisteredTool } from "@modelcontextprotocol/sdk/server/mcp.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  CallToolRequestSchema,
  type CallToolResult,
  ErrorCode,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import type { GoogleMcpEnv } from "./env.ts";
import type { CalendarClient } from "./google-calendar.ts";
import { errorText, isTransientError } from "./tools/common.ts";
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

type ToolHandler = (args: unknown, extra: unknown) => Promise<CallToolResult>;

export interface ToolLogEntry {
  event: "tool.call";
  tool: string;
  calendarId?: string;
  latencyMs: number;
  outcome: "success" | "deterministic_error" | "transient_error" | "validation_error";
}

export type ToolLogger = (entry: ToolLogEntry) => void;

function defaultLogger(entry: ToolLogEntry): void {
  console.log(JSON.stringify(entry));
}

function guard(fn: () => Promise<CallToolResult>): Promise<CallToolResult> {
  return fn().catch((error: unknown) => {
    if (isTransientError(error)) {
      throw new McpError(ErrorCode.InternalError, errorText(error));
    }
    return {
      isError: true,
      content: [{ type: "text" as const, text: errorText(error) }],
    };
  });
}

export function createServer(
  client: CalendarClient,
  env: GoogleMcpEnv,
  logger: ToolLogger = defaultLogger,
): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: { listChanged: false } } },
  );
  const registeredTools = new Map<string, RegisteredTool>();

  const listCalendarsTool = server.registerTool(
    "list_calendars",
    {
      description: "List calendars visible to the authenticated Google account",
      inputSchema: listCalendarsSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => guard(() => listCalendars(client, args)),
  );
  registeredTools.set("list_calendars", listCalendarsTool);

  const listEventsTool = server.registerTool(
    "list_events",
    {
      description: "List events on a calendar within an optional time range",
      inputSchema: listEventsSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => guard(() => listEvents(client, env, args)),
  );
  registeredTools.set("list_events", listEventsTool);

  const getEventTool = server.registerTool(
    "get_event",
    {
      description: "Fetch one event by ID",
      inputSchema: getEventSchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => guard(() => getEvent(client, env, args)),
  );
  registeredTools.set("get_event", getEventTool);

  const createEventTool = server.registerTool(
    "create_event",
    {
      description: "Create a calendar event",
      inputSchema: createEventSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (args) => guard(() => createEvent(client, env, args)),
  );
  registeredTools.set("create_event", createEventTool);

  const updateEventTool = server.registerTool(
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
  registeredTools.set("update_event", updateEventTool);

  const deleteEventTool = server.registerTool(
    "delete_event",
    {
      description: "Delete an event by ID",
      inputSchema: deleteEventSchema,
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
    },
    (args) => guard(() => deleteEvent(client, env, args)),
  );
  registeredTools.set("delete_event", deleteEventTool);

  const freeBusyTool = server.registerTool(
    "free_busy",
    {
      description: "Query busy intervals for one or more calendars",
      inputSchema: freeBusySchema,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
    },
    (args) => guard(() => freeBusy(client, env, args)),
  );
  registeredTools.set("free_busy", freeBusyTool);

  const quickAddTool = server.registerTool(
    "quick_add",
    {
      description: "Create an event from natural language text (Google quickAdd)",
      inputSchema: quickAddSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    },
    (args) => guard(() => quickAdd(client, env, args)),
  );
  registeredTools.set("quick_add", quickAddTool);

  // The high-level SDK wraps tool errors as isError results; keep transient failures as protocol errors.
  server.server.removeRequestHandler("tools/call");
  server.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const started = performance.now();
    const tool = request.params.name;
    const args = request.params.arguments ?? {};
    const calendarId =
      typeof args === "object" && args !== null && "calendarId" in args
        ? (args as { calendarId?: unknown }).calendarId
        : undefined;

    const log = (outcome: ToolLogEntry["outcome"]) =>
      logger({
        event: "tool.call",
        tool,
        ...(typeof calendarId === "string" ? { calendarId } : {}),
        latencyMs: performance.now() - started,
        outcome,
      });

    const registered = registeredTools.get(tool);
    if (!registered?.enabled) {
      log("validation_error");
      throw new McpError(ErrorCode.InvalidParams, `Tool ${tool} not found`);
    }

    let parsed: unknown = args;
    try {
      const schema = registered.inputSchema as
        | { parseAsync(value: unknown): Promise<unknown> }
        | undefined;
      if (schema) parsed = await schema.parseAsync(parsed);
    } catch (error) {
      log("validation_error");
      throw new McpError(
        ErrorCode.InvalidParams,
        `Input validation error: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    try {
      const result = await (registered.handler as ToolHandler)(parsed, extra);
      log(result.isError ? "deterministic_error" : "success");
      return result;
    } catch (error) {
      log(isTransientError(error) ? "transient_error" : "deterministic_error");
      throw error;
    }
  });

  return server;
}
