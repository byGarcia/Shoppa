export class FetchError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown,
  ) {
    super(message);
    this.name = "FetchError";
  }
}

// Module-level flag so concurrent 401s only trigger one navigation. Without
// this, every parallel query (dashboard, pending, etc.) writes a duplicate
// /login entry into history.
let unauthRedirectStarted = false;

/**
 * Fetch JSON from a same-origin authenticated endpoint and return it typed.
 * Throws FetchError on non-2xx responses.
 */
export async function fetchJson<T>(input: string, init?: RequestInit): Promise<T> {
  const res = await fetch(input, {
    credentials: "same-origin",
    headers: {
      Accept: "application/json",
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...init?.headers,
    },
    ...init,
  });

  if (res.status === 204) {
    return undefined as T;
  }

  let body: unknown = null;
  const text = await res.text();
  if (text.length > 0) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      // Session expired or revoked. Mobile's fetcher also purges a persisted
      // query cache here; this app's QueryClient has no persistor
      // (recorded deviation #5), so there is nothing to purge. Module flag
      // deduplicates concurrent 401s into a single navigation.
      // /setup is excluded too: a 401 there means "that installation token is
      // wrong", not "your session expired", and bouncing to /login from an
      // unclaimed instance lands straight back on /setup with the form
      // emptied — a stumble that reads as a loop.
      const onAnEntryScreen =
        window.location.pathname === "/login" || window.location.pathname === "/setup";
      if (!unauthRedirectStarted && !onAnEntryScreen) {
        unauthRedirectStarted = true;
        const here = window.location.pathname + window.location.search;
        const target = `/login?from=${encodeURIComponent(here)}`;
        window.location.assign(target);
      }
    }
    // ApiResponse helpers return `{ error: "..." }` on every error path; some
    // legacy responses use `{ message: "..." }`. Read both, prefer `error`,
    // fall back to status. Without this, every mutation surfaces "HTTP 4xx"
    // to the toast/UI instead of the Spanish message the server actually
    // sent.
    let message = `HTTP ${res.status}`;
    if (typeof body === "object" && body !== null) {
      const obj = body as { error?: unknown; message?: unknown };
      if (typeof obj.error === "string" && obj.error.length > 0) {
        message = obj.error;
      } else if (typeof obj.message === "string" && obj.message.length > 0) {
        message = obj.message;
      }
    }
    throw new FetchError(message, res.status, body);
  }

  return body as T;
}
