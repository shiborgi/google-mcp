#!/usr/bin/env bun
/**
 * Local helper to obtain a Google refresh token for the Calendar scope.
 *
 * Usage:
 *   GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... bun run scripts/google-auth.ts
 *
 * 1. Opens the consent URL.
 * 2. Starts a loopback server on http://127.0.0.1:53682 (must be registered as
 *    a redirect URI in the OAuth client, "Web application" type).
 * 3. Exchanges the returned code and prints the refresh token.
 */

const SCOPE = "https://www.googleapis.com/auth/calendar";
const REDIRECT_URI = "http://127.0.0.1:53682/oauth2/callback";

const clientId = process.env.GOOGLE_CLIENT_ID;
const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.");
  process.exit(1);
}

const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
authUrl.searchParams.set("client_id", clientId);
authUrl.searchParams.set("redirect_uri", REDIRECT_URI);
authUrl.searchParams.set("response_type", "code");
authUrl.searchParams.set("scope", SCOPE);
authUrl.searchParams.set("access_type", "offline");
authUrl.searchParams.set("prompt", "consent");

console.log("Open this URL in your browser and authorize the application:\n");
console.log(authUrl.toString());

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 53682,
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname !== "/oauth2/callback") return new Response("Not found", { status: 404 });
    const code = url.searchParams.get("code");
    if (!code) return new Response("Missing code", { status: 400 });

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: REDIRECT_URI,
        grant_type: "authorization_code",
      }),
    });
    const body = (await response.json()) as { refresh_token?: string; error?: string };
    setTimeout(() => process.exit(body.refresh_token ? 0 : 1), 100);
    if (!response.ok || !body.refresh_token) {
      console.error("\nToken exchange failed:", body.error ?? response.status);
      console.error(
        "Re-run the script; Google returns refresh_token only when prompted for consent.",
      );
      return new Response("Token exchange failed; check the terminal.", { status: 500 });
    }
    console.log("\nSuccess. Store this refresh token in your .env as GOOGLE_REFRESH_TOKEN:\n");
    console.log(body.refresh_token);
    return new Response("Authorization complete. You can close this tab.");
  },
});

console.log(`\nWaiting for the consent redirect on ${REDIRECT_URI} ...`);
void server;
