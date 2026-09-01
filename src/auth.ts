import { createHash, timingSafeEqual } from "node:crypto";

const BEARER_TOKEN_PATTERN = /^Bearer ([A-Za-z0-9._~+\-/]+=*)$/;

export interface TokenSet {
  accessToken: string;
  expiresAt: number;
}

export interface TokenBroker {
  accessToken(): Promise<string>;
}

export class GoogleAuthError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

export function hasValidBearerToken(header: string | undefined, expectedToken: string): boolean {
  const match = header === undefined ? undefined : BEARER_TOKEN_PATTERN.exec(header);
  const providedToken = match?.[1];
  if (providedToken === undefined) return false;

  const providedDigest = createHash("sha256").update(providedToken).digest();
  const expectedDigest = createHash("sha256").update(expectedToken).digest();
  return timingSafeEqual(providedDigest, expectedDigest);
}

export async function validateStartupCredentials(
  clientId: string,
  clientSecret: string,
  refreshToken: string,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  const broker = new RefreshTokenBroker(clientId, clientSecret, refreshToken, fetcher);
  await broker.accessToken();
}

export class RefreshTokenBroker implements TokenBroker {
  #cached: TokenSet | undefined;

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly refreshToken: string,
    private readonly fetcher: typeof fetch = fetch,
  ) {}

  async accessToken(): Promise<string> {
    if (this.#cached && this.#cached.expiresAt > Date.now() + 15_000) {
      return this.#cached.accessToken;
    }
    const response = await this.fetcher("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        refresh_token: this.refreshToken,
        grant_type: "refresh_token",
      }),
      redirect: "error",
    });
    if (!response.ok) {
      throw new GoogleAuthError(
        `Google token refresh failed with HTTP ${response.status}`,
        response.status,
      );
    }
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new GoogleAuthError("Google token refresh response did not include access_token");
    }
    this.#cached = {
      accessToken: body.access_token,
      expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000,
    };
    return body.access_token;
  }
}
