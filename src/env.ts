export interface GoogleMcpEnv {
  port: number;
  token?: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  defaultCalendarId: string;
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadEnv(env: NodeJS.ProcessEnv = process.env): GoogleMcpEnv {
  const port = Number(env.GOOGLE_MCP_PORT ?? 8090);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("GOOGLE_MCP_PORT must be an integer between 1 and 65535");
  }
  const token = env.GOOGLE_MCP_TOKEN?.trim() || undefined;
  return {
    port,
    token,
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    refreshToken: required("GOOGLE_REFRESH_TOKEN"),
    defaultCalendarId: env.GOOGLE_DEFAULT_CALENDAR_ID?.trim() || "primary",
  };
}
