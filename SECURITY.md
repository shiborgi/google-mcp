# Security

Report vulnerabilities privately through GitHub's security advisory feature for
`shiborgi/google-mcp`. Do not open a public issue with credentials, tokens, or
calendar contents.

## Expectations

- Never commit OAuth client secrets, refresh tokens, access tokens, or the MCP
  bearer token.
- `.env` is intentionally ignored; rotate any value that was ever exposed.
- The refresh token grants full Google Calendar access to the authenticated
  account; store it only in local ignored files or a secret manager.
- Prefer `GOOGLE_MCP_TOKEN` in every environment where the port is reachable by
  other processes or containers.
