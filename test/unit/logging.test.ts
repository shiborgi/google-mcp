import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { GoogleMcpEnv } from "../../src/env.ts";
import { type CalendarClient, GoogleApiError } from "../../src/google-calendar.ts";
import { createServer, type ToolLogEntry } from "../../src/server.ts";

const env: GoogleMcpEnv = {
  port: 8090,
  clientId: "id",
  clientSecret: "client-secret",
  refreshToken: "refresh-token",
  defaultCalendarId: "primary",
};

function fakeClient(overrides: Partial<CalendarClient> = {}): CalendarClient {
  return {
    async get() {
      return { items: [{ id: "primary", summary: "Personal" }] };
    },
    async post() {},
    async patch() {},
    async delete() {},
    ...overrides,
  };
}

async function connected(client: CalendarClient, lines: string[]) {
  const server = createServer(client, env, (entry: ToolLogEntry) =>
    lines.push(JSON.stringify(entry)),
  );
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "logging-test", version: "0.0.0" }, { capabilities: {} });
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { server, mcp };
}

describe("tool-call logging", () => {
  test("logs one JSON entry for a successful call", async () => {
    const lines: string[] = [];
    const { server, mcp } = await connected(fakeClient(), lines);

    await mcp.callTool({ name: "list_calendars", arguments: {} });

    expect(lines).toHaveLength(1);
    const entry = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(entry).toMatchObject({
      event: "tool.call",
      tool: "list_calendars",
      outcome: "success",
    });
    expect(typeof entry.latencyMs).toBe("number");
    await mcp.close();
    await server.close();
  });

  test("logs deterministic errors without secrets or event content", async () => {
    const lines: string[] = [];
    const client = fakeClient({
      async post() {
        throw new GoogleApiError("event not found", 404);
      },
    });
    const { server, mcp } = await connected(client, lines);

    const result = await mcp.callTool({
      name: "create_event",
      arguments: {
        calendarId: "work",
        summary: "event title",
        description: "private event description",
        start: { dateTime: "2026-08-28T09:00:00-03:00" },
        end: { dateTime: "2026-08-28T10:00:00-03:00" },
      },
    });

    expect(result.isError).toBe(true);
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "tool.call",
      tool: "create_event",
      calendarId: "work",
      outcome: "deterministic_error",
    });
    expect(lines[0]).not.toContain(env.clientSecret);
    expect(lines[0]).not.toContain(env.refreshToken);
    expect(lines[0]).not.toContain("private event description");
    await mcp.close();
    await server.close();
  });

  test("logs validation failures without input values", async () => {
    const lines: string[] = [];
    const { server, mcp } = await connected(fakeClient(), lines);

    await expect(
      mcp.callTool({
        name: "create_event",
        arguments: {
          summary: "event title",
          description: env.refreshToken,
          start: { date: "2026-08-28" },
          end: { dateTime: "2026-08-28T10:00:00-03:00" },
        },
      }),
    ).rejects.toMatchObject({ name: "McpError", code: -32602 });

    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({
      event: "tool.call",
      tool: "create_event",
      outcome: "validation_error",
    });
    expect(lines[0]).not.toContain(env.refreshToken);
    expect(lines[0]).not.toContain("event title");
    await mcp.close();
    await server.close();
  });
});
