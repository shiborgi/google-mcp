import type { TokenBroker } from "./auth.ts";

type Delay = (milliseconds: number) => Promise<void>;

const MAX_ATTEMPTS = 3;
const MAX_TOTAL_RETRY_DELAY_MS = 15_000;
const MAX_RETRY_AFTER_MS = 10_000;
const BASE_RETRY_DELAY_MS = 250;

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
    private readonly delay: Delay = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
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
    let retryDelaySpent = 0;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
      let response: Response;
      try {
        response = await this.fetcher(url, {
          ...init,
          headers: {
            authorization: `Bearer ${accessToken}`,
            "content-type": "application/json",
            accept: "application/json",
          },
          redirect: "error",
          signal: AbortSignal.timeout(30_000),
        });
      } catch (error) {
        if (attempt === MAX_ATTEMPTS - 1) throw error;
        retryDelaySpent += await this.#waitForRetry(attempt, undefined, retryDelaySpent);
        continue;
      }

      if (response.status === 204) return undefined;
      const text = await response.text();
      if (!response.ok) {
        const error = new GoogleApiError(
          `Google Calendar API returned HTTP ${response.status}: ${text.slice(0, 200)}`,
          response.status,
        );
        if (!this.#isRetryableStatus(response.status) || attempt === MAX_ATTEMPTS - 1) {
          throw error;
        }
        retryDelaySpent += await this.#waitForRetry(
          attempt,
          response.headers.get("retry-after"),
          retryDelaySpent,
        );
        continue;
      }
      return text ? JSON.parse(text) : undefined;
    }

    throw new Error("Google Calendar request retry loop ended unexpectedly");
  }

  #isRetryableStatus(status: number): boolean {
    return status === 429 || status >= 500;
  }

  async #waitForRetry(
    attempt: number,
    retryAfter: string | null | undefined,
    retryDelaySpent: number,
  ): Promise<number> {
    const remaining = Math.max(0, MAX_TOTAL_RETRY_DELAY_MS - retryDelaySpent);
    const requested =
      retryAfter === undefined || retryAfter === null
        ? BASE_RETRY_DELAY_MS * 2 ** attempt * (0.75 + Math.random() * 0.5)
        : (retryAfterMilliseconds(retryAfter) ?? BASE_RETRY_DELAY_MS * 2 ** attempt);
    const milliseconds = Math.min(Math.round(requested), remaining);
    if (milliseconds > 0) await this.delay(milliseconds);
    return milliseconds;
  }
}

function retryAfterMilliseconds(value: string): number | undefined {
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.min(Math.max(0, date - Date.now()), MAX_RETRY_AFTER_MS);
  }
  return undefined;
}
