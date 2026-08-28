# google-mcp

An MCP server for Google Calendar built to run as an upstream server behind
[Barback](https://github.com/shiborgi/barback). It uses the same stack and
project standards as Barback: Bun 1.4, strict TypeScript, Biome, zod v4, and
the official `@modelcontextprotocol/sdk`.

The server speaks MCP over Streamable HTTP, the transport Barback's MCP
registry prefers for networked upstreams.

## Tools

| Tool | Effect | Description |
| --- | --- | --- |
| `list_calendars` | read | Calendars visible to the authenticated account |
| `list_events` | read | Events with time range, search, and pagination |
| `get_event` | read | Fetch one event by ID |
| `free_busy` | read | Busy intervals for one or more calendars |
| `create_event` | write | Create an event (attendees, all-day, reminders) |
| `update_event` | write | Patch selected fields of an event |
| `delete_event` | write | Delete an event |
| `quick_add` | write | Create an event from natural language text |

Read tools are annotated with `readOnlyHint` so Barback's tool policies can
classify and cache them as reads.

## Authentication

The server uses an OAuth refresh token for a user account and calls the
Calendar API with short-lived access tokens:

1. In Google Cloud Console, enable the **Google Calendar API** and create an
   OAuth client of type **Web application** with the redirect URI
   `http://127.0.0.1:53682/oauth2/callback`.
2. Run the local consent helper once:

   ```sh
   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... bun run scripts/google-auth.ts
   ```

   Open the printed URL, authorize, and copy the printed refresh token.
3. Put the credentials in `.env` (see [.env.example](.env.example)). Keep all
   values out of source control.

The MCP endpoint itself can require a bearer token via `GOOGLE_MCP_TOKEN`.
Barback sends it as an upstream credential; without the variable the endpoint
is open for local development.

## Run

```sh
bun install --frozen-lockfile
cp .env.example .env
# Fill GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN.
bun run start
```

Interfaces:

- `POST /mcp` — MCP Streamable HTTP endpoint
- `GET /health` and `GET /health/live`

## Barback integration

Run google-mcp as a container on the same Apple Container network as Barback:

```sh
./scripts/start-google-mcp.sh
```

The script prints the resolved container IP and a ready-to-paste
`GOOGLE_MCP_URL=http://<ip>:8090/mcp` line after the health check. Apple
Container does not resolve container names via DNS, and published ports can be
unreachable from the host, so the working address is the container IP on the
shared network; use the printed `GOOGLE_MCP_URL` below. The IP changes when the
container restarts, and [Barback](https://github.com/shiborgi/barback)'s
startup script re-resolves it and injects the value at startup.

Then register it in `barback.yaml`:

```yaml
mcp:
  servers:
    - id: google
      transport: streamable-http
      url: env:GOOGLE_MCP_URL
      required: true
      auth:
        bearerToken: env:GOOGLE_MCP_TOKEN
      tools:
        default: deny
        allow: [list_calendars, list_events, get_event, free_busy, create_event, update_event, delete_event, quick_add]
        policies:
          list_calendars: { effect: read, cache: { mode: exact, ttl: 5m } }
          list_events:    { effect: read, cache: { mode: none } }
          get_event:      { effect: read, cache: { mode: exact, ttl: 1m } }
          free_busy:      { effect: read, cache: { mode: none } }
          create_event:   { effect: write, cache: { mode: none } }
          update_event:   { effect: write, cache: { mode: none } }
          delete_event:   { effect: write, cache: { mode: none } }
          quick_add:      { effect: write, cache: { mode: none } }
  toolsets:
    calendar:
      - google:list_calendars
      - google:list_events
      - google:get_event
      - google:free_busy
      - google:create_event
      - google:update_event
      - google:delete_event
      - google:quick_add
```

`GOOGLE_MCP_URL` is resolved from the environment at startup by Barback's
recursive `env:` config loader, so the example needs no further edits. Grant
the toolset to a policy (`mcpToolsets: [calendar]`) and the scopes `mcp:list`
and `mcp:call` to the client. Clients then see the tools as `google.list_events`
and so on.

## Development

```sh
bun run check
bun run test:contract
```

The contract suite exercises the tool surface through a real MCP client over an
in-memory transport and the HTTP layer over a spawned server; no Google
credentials are needed for tests.

## License

MIT
