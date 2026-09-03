import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The real cost of `local` is the wait: HOME_FETCH_WAIT_MS is 30 s per product
 * waiting for a reader that in this mode does not exist. What is checked here
 * is that the queue is not touched at all.
 */
const enqueueFetch = vi.hoisted(() => vi.fn((url: string): unknown => ({ id: "1", url })));
const awaitFetch = vi.hoisted(() =>
  // If anyone calls it, the test hangs instead of passing by accident.
  vi.fn((): Promise<unknown> => new Promise(() => {})),
);
vi.mock("./fetch-jobs", () => ({ enqueueFetch, awaitFetch }));

// Without this, checking the URL goes out to the Internet to resolve the domain.
vi.mock("node:dns/promises", () => ({
  lookup: vi.fn(async () => [{ address: "93.184.216.34" }]),
}));

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env = { ...ORIGINAL, APP_ORIGIN: "https://a.example" };
  enqueueFetch.mockClear();
  awaitFetch.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  process.env = { ...ORIGINAL };
});

const PAGE = '<html><head><title>Producto</title></head><body>12,50 EUR</body></html>';

function response(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/html" } });
}

describe("fetchProductHtml in local mode", () => {
  it("does not ask home for help even when the store answers with silence", async () => {
    process.env.PRICE_FETCH_MODE = "local";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connect ECONNREFUSED");
      }),
    );
    // Fake timers that nobody advances: if the promise resolved by waiting on
    // a timer, this test would never finish.
    vi.useFakeTimers();

    const { fetchProductHtml } = await import("./price-fetch.ts");
    const result = await fetchProductHtml("https://tienda.example/producto");

    expect(result.ok).toBe(false);
    expect(enqueueFetch).not.toHaveBeenCalled();
    expect(awaitFetch).not.toHaveBeenCalled();
  });

  it("does not ask for it on the stores that always ask for it either", async () => {
    // Amazon is the store for which the home reader goes FIRST. In local mode
    // there is no reader, so the request has to go out from here anyway.
    process.env.PRICE_FETCH_MODE = "local";
    const stub = vi.fn(async () => response(PAGE));
    vi.stubGlobal("fetch", stub);
    vi.useFakeTimers();

    const { fetchProductHtml } = await import("./price-fetch.ts");
    const result = await fetchProductHtml("https://www.amazon.es/dp/B000000000");

    expect(result.ok).toBe(true);
    expect(enqueueFetch).not.toHaveBeenCalled();
    expect(stub).toHaveBeenCalled();
  });

  it("in assisted mode the queue is used again", async () => {
    process.env.PRICE_FETCH_MODE = "assisted";
    awaitFetch.mockImplementation(async () => ({ html: PAGE }));
    vi.stubGlobal("fetch", vi.fn(async () => response(PAGE)));

    const { fetchProductHtml } = await import("./price-fetch.ts");
    const result = await fetchProductHtml("https://www.amazon.es/dp/B000000000");

    expect(result.ok).toBe(true);
    expect(enqueueFetch).toHaveBeenCalledWith("https://www.amazon.es/dp/B000000000");
  });
});
