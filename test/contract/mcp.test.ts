import { describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { GoogleMcpEnv } from "../../src/env.ts";
import { type CalendarClient, GoogleApiError } from "../../src/google-calendar.ts";
import { createServer } from "../../src/server.ts";

const env: GoogleMcpEnv = {
  port: 8090,
  clientId: "id",
  clientSecret: "secret",
  refreshToken: "refresh",
  defaultCalendarId: "primary",
};

function fakeClient(overrides: Partial<CalendarClient> = {}): CalendarClient {
  return {
    async get(path: string) {
      if (path === "/users/me/calendarList")
        return { items: [{ id: "primary", summary: "Personal" }] };
      if (path === "/calendars/primary/events")
        return { items: [{ id: "evt-1", summary: "Planning" }] };
      return { id: "evt-1", summary: "Planning" };
    },
    async post(_path: string, body: unknown) {
      return { id: "evt-2", ...(body as object) };
    },
    async patch() {
      return { id: "evt-1", summary: "Updated" };
    },
    async delete() {},
    ...overrides,
  };
}

async function connected(client: CalendarClient = fakeClient()) {
  const server = createServer(client, env);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "contract-test", version: "0.0.0" }, { capabilities: {} });
  await server.connect(serverTransport);
  await mcp.connect(clientTransport);
  return { server, mcp };
}

describe("MCP contract", () => {
  test("lists the calendar tools with schemas and annotations", async () => {
    const { server, mcp } = await connected();
    const listed = await mcp.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([
      "create_event",
      "delete_event",
      "free_busy",
      "get_event",
      "list_calendars",
      "list_events",
      "quick_add",
      "update_event",
    ]);
    const listCalendars = listed.tools.find((tool) => tool.name === "list_calendars");
    expect(listCalendars?.annotations?.readOnlyHint).toBe(true);
    expect(listCalendars?.inputSchema.type).toBe("object");
    await mcp.close();
    await server.close();
  });

  test("list_calendars returns structured content and text", async () => {
    const { server, mcp } = await connected();
    const result = await mcp.callTool({ name: "list_calendars", arguments: {} });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual({
      items: [{ id: "primary", summary: "Personal" }],
    });
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(text).toContain('"summary": "Personal"');
    await mcp.close();
    await server.close();
  });

  test("transient tool errors are returned as protocol errors", async () => {
    const failing = fakeClient({
      async get() {
        throw new GoogleApiError("upstream unavailable", 429);
      },
    });
    const { server, mcp } = await connected(failing);
    await expect(mcp.callTool({ name: "list_calendars", arguments: {} })).rejects.toMatchObject({
      name: "McpError",
      code: -32603,
      message: expect.stringContaining("upstream unavailable"),
    });
    await mcp.close();
    await server.close();
  });

  test("deterministic tool errors remain isError results", async () => {
    const failing = fakeClient({
      async get() {
        throw new GoogleApiError("event not found", 404);
      },
    });
    const { server, mcp } = await connected(failing);
    const result = await mcp.callTool({ name: "list_calendars", arguments: {} });
    expect(result.isError).toBe(true);
    const text = (result.content as { type: string; text: string }[])[0]?.text ?? "";
    expect(text).toContain("event not found");
    await mcp.close();
    await server.close();
  });
});
