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

google-mcp runs as a Barback-managed service on the Apple Container NAT network
that Barback owns. Barback creates the network, the DNS resolver, and the
lifecycle; google-mcp only consumes the injected resolver, search domain, and
identity labels. The service is reached through its canonical FQDN,
`google.mcp.barback.internal:8090`, which Barback's DNS control plane keeps
current. You never inject a container IP into google-mcp or Barback, and you
never rerun Barback after google-mcp's address changes.

Launch the managed container with the Barback-supplied inputs:

```sh
BARBACK_CONTAINER_NETWORK=barback \
BARBACK_DNS_RESOLVER=<resolver-ip> \
BARBACK_DNS_SEARCH=barback.internal \
BARBACK_STACK_ID=barback-local \
./scripts/start-google-mcp.sh
```

The script requires the network, resolver, search domain, and stack identity,
never creates the network or DNS records, never publishes port 8090, and prints
the canonical endpoint `GOOGLE_MCP_URL=http://google.mcp.barback.internal:8090/mcp`.

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

The managed container carries the `io.shiborgi.barback.stack`,
`io.shiborgi.barback.service=google`, and `io.shiborgi.barback.role=mcp` labels
so Barback can reconcile and re-identify it. When Barback recreates google-mcp
at a different address, the DNS control plane converges within Barback's
15-second budget and the FQDN keeps working without recreating `barback-gateway`.

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
