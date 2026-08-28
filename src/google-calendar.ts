import type { TokenBroker } from "./auth.ts";

export class GoogleApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export interface CalendarClient {
  get(
    path: string,
    query?: Record<string, string | number | boolean | undefined>,
  ): Promise<unknown>;
  post(path: string, body: unknown): Promise<unknown>;
  patch(path: string, body: unknown): Promise<unknown>;
  delete(path: string): Promise<void>;
}

export class GoogleCalendarClient implements CalendarClient {
  constructor(
    private readonly tokens: TokenBroker,
    private readonly fetcher: typeof fetch = fetch,
    private readonly baseUrl = "https://www.googleapis.com/calendar/v3",
  ) {}

  async get(path: string, query?: Record<string, string | number | boolean | undefined>) {
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
    return this.#request(url, { method: "GET" });
  }

  async post(path: string, body: unknown) {
    return this.#request(new URL(`${this.baseUrl}${path}`), {
      method: "POST",
      body: JSON.stringify(body),
    });
  }

  async patch(path: string, body: unknown) {
    return this.#request(new URL(`${this.baseUrl}${path}`), {
      method: "PATCH",
      body: JSON.stringify(body),
    });
  }

  async delete(path: string) {
    await this.#request(new URL(`${this.baseUrl}${path}`), { method: "DELETE" });
  }

  async #request(url: URL, init: RequestInit): Promise<unknown> {
    const accessToken = await this.tokens.accessToken();
    const response = await this.fetcher(url, {
      ...init,
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (!response.ok) {
      throw new GoogleApiError(
        `Google Calendar API returned HTTP ${response.status}: ${text.slice(0, 200)}`,
        response.status,
      );
    }
    return text ? JSON.parse(text) : undefined;
  }
}
