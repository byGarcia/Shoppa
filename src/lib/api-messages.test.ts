import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiText, serverLocale } from "./api-messages.ts";

/**
 * The path under test is the one with no request: Vitest drives the route
 * handlers directly, and so does the scheduled price run, whose Telegram alerts
 * are composed by a timer rather than by somebody's browser. There is no
 * `Accept-Language` and no cookie on either, so the language can only come from
 * the installation's `DEFAULT_LOCALE`.
 */
const ORIGINAL = { ...process.env };

beforeEach(() => {
  // The fallback warns on purpose — see api-messages.ts — and that warning is
  // the expected outcome here, not noise to be surprised by.
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  vi.restoreAllMocks();
});

describe("copy composed outside a request", () => {
  it("falls back to Spanish, which is what an installation gets by default", async () => {
    process.env = { ...ORIGINAL, DEFAULT_LOCALE: undefined };
    expect(await apiText("prices.noPriceFound")).toBe("No encontré el precio en la página");
    expect(await serverLocale()).toBe("es");
  });

  it("follows DEFAULT_LOCALE, so an English installation gets English alerts", async () => {
    process.env = { ...ORIGINAL, DEFAULT_LOCALE: "en" };
    expect(await apiText("prices.noPriceFound")).toBe("I could not find the price on the page");
    expect(await serverLocale()).toBe("en");
  });
});
