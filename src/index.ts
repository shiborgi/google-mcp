import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { Hono } from "hono";
import { RefreshTokenBroker, validateStartupCredentials } from "./auth.ts";
import { type GoogleMcpEnv, loadEnv } from "./env.ts";
import { GoogleCalendarClient } from "./google-calendar.ts";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.ts";

function unauthorized() {
  return Response.json(
    { jsonrpc: "2.0", id: null, error: { code: -32001, message: "Invalid MCP token" } },
    { status: 401 },
  );
}

export function createApp(env: GoogleMcpEnv = loadEnv()) {
  const tokens = new RefreshTokenBroker(env.clientId, env.clientSecret, env.refreshToken);
  const calendar = new GoogleCalendarClient(tokens);
  const app = new Hono();

  app.get("/health/live", (c) => c.json({ status: "live" }));
  app.get("/health", (c) =>
    c.json({ status: "ready", server: SERVER_NAME, version: SERVER_VERSION }),
  );

  app.use("/mcp", async (c, next) => {
    if (env.token) {
      const header = c.req.header("authorization");
      if (header !== `Bearer ${env.token}`) return unauthorized();
    }
    await next();
  });

  app.all("/mcp", async (c) => {
    const server = createServer(calendar, env);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      await transport.close().catch(() => undefined);
      await server.close().catch(() => undefined);
    }
  });

  return app;
}

if (import.meta.main) {
  const env = loadEnv();
  if (!process.env.GOOGLE_MCP_SKIP_TOKEN_CHECK) {
    try {
      await validateStartupCredentials(env.clientId, env.clientSecret, env.refreshToken);
    } catch (error) {
      console.log(
        JSON.stringify({
          event: "startup.credential_check_failed",
          error: error instanceof Error ? error.name : String(error),
        }),
      );
      process.exit(1);
    }
  }
  const app = createApp(env);
  const server = Bun.serve({
    hostname: "0.0.0.0",
    port: env.port,
    fetch: app.fetch,
  });
  console.log(
    JSON.stringify({
      event: "server.started",
      name: SERVER_NAME,
      version: SERVER_VERSION,
      url: server.url.toString(),
    }),
  );
  process.on("SIGINT", () => void server.stop(false));
  process.on("SIGTERM", () => void server.stop(false));
}
