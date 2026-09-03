import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  checkRouteCeiling,
  INSTANCE_CEILING_PER_MIN,
  MAX_FAILURES,
  isThrottled,
  recordFailure,
  recordSuccess,
  resetThrottleForTests,
  ROUTE_CEILING_PER_MIN,
  WINDOW_MS,
} from "./login-throttle.ts";

beforeEach(() => {
  vi.useFakeTimers();
  resetThrottleForTests();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("per-account throttle", () => {
  it("lets the first failures through", () => {
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) recordFailure("ana@example.com");
    expect(isThrottled("ana@example.com")).toBe(false);
  });

  it("throttles on reaching the maximum", () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("ana@example.com");
    expect(isThrottled("ana@example.com")).toBe(true);
  });

  it("does not drag another account down with it", () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("ana@example.com");
    expect(isThrottled("luis@example.com")).toBe(false);
  });

  it("releases once the window passes: it is a wait, not a permanent lockout", () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("ana@example.com");
    vi.advanceTimersByTime(WINDOW_MS + 1);
    expect(isThrottled("ana@example.com")).toBe(false);
  });

  it("a success clears the counter", () => {
    for (let i = 0; i < MAX_FAILURES - 1; i += 1) recordFailure("ana@example.com");
    recordSuccess("ana@example.com");
    recordFailure("ana@example.com");
    expect(isThrottled("ana@example.com")).toBe(false);
  });
});

describe("instance ceiling", () => {
  it("throttles everything when failures per minute spike, even from different accounts", () => {
    for (let i = 0; i < INSTANCE_CEILING_PER_MIN; i += 1) recordFailure(`cuenta${i}@example.com`);
    expect(isThrottled("nueva@example.com")).toBe(true);
  });

  it("does not shut out anyone who has already logged in once: the ceiling is not a global lockout", () => {
    recordSuccess("ana@example.com");
    for (let i = 0; i < INSTANCE_CEILING_PER_MIN; i += 1) recordFailure(`cuenta${i}@example.com`);
    expect(isThrottled("ana@example.com")).toBe(false);
    expect(isThrottled("nadie@example.com")).toBe(true);
  });

  it("normalizes the key, or changing the capitalization would start a fresh counter", () => {
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("ana@example.com");
    expect(isThrottled("  Ana@Example.com  ")).toBe(true);
  });

  it("does not grow without bound: with the map full of live entries, it stops taking new keys", () => {
    for (let i = 0; i < 10_000; i += 1) recordFailure(`relleno${i}@example.com`);
    // The minute is advanced so the filler does not leave the instance ceiling
    // stuck on: without this, isThrottled would cut in at the ceiling and the
    // test would never get to look at the map, which is what it wants to
    // measure. Fifteen minutes have not passed, so the 10,000 entries are
    // still live and the map is still full.
    vi.advanceTimersByTime(60_000 + 1);
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("desbordante@example.com");
    expect(isThrottled("desbordante@example.com")).toBe(false);

    // And that this false comes from the cap and not from some other
    // coincidence: as soon as the map empties when the window expires, the
    // same five failures do throttle.
    vi.advanceTimersByTime(WINDOW_MS + 1);
    for (let i = 0; i < MAX_FAILURES; i += 1) recordFailure("desbordante@example.com");
    expect(isThrottled("desbordante@example.com")).toBe(true);
  });

  it("the ceiling releases after a minute", () => {
    for (let i = 0; i < INSTANCE_CEILING_PER_MIN; i += 1) recordFailure(`cuenta${i}@example.com`);
    vi.advanceTimersByTime(60_000 + 1);
    expect(isThrottled("nueva@example.com")).toBe(false);
  });
});

describe("per-route ceiling", () => {
  it("lets requests through up to the cap and cuts off the next one", () => {
    for (let i = 0; i < ROUTE_CEILING_PER_MIN; i += 1) {
      expect(checkRouteCeiling("/api/ingest")).toBe(true);
    }
    expect(checkRouteCeiling("/api/ingest")).toBe(false);
  });

  it("each route keeps its own count", () => {
    for (let i = 0; i < ROUTE_CEILING_PER_MIN; i += 1) checkRouteCeiling("/api/ingest");
    expect(checkRouteCeiling("/login")).toBe(true);
  });

  it("releases after a minute: the household is not left without voice forever", () => {
    for (let i = 0; i < ROUTE_CEILING_PER_MIN; i += 1) checkRouteCeiling("/api/ingest");
    expect(checkRouteCeiling("/api/ingest")).toBe(false);
    vi.advanceTimersByTime(60_000 + 1);
    expect(checkRouteCeiling("/api/ingest")).toBe(true);
  });

  it("it is a shared ceiling: it does not depend on who is calling", () => {
    // There is no caller key in play; the same counter is drained by different
    // visitors, which is exactly what makes it unforgeable through a header.
    for (let i = 0; i < ROUTE_CEILING_PER_MIN; i += 1) checkRouteCeiling("/login");
    expect(checkRouteCeiling("/login")).toBe(false);
  });

  it("the per-account throttle does not touch it", () => {
    for (let i = 0; i < ROUTE_CEILING_PER_MIN; i += 1) recordFailure(`cuenta${i}@example.com`);
    expect(checkRouteCeiling("/login")).toBe(true);
  });
});
