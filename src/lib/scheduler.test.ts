import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  nextRunAt,
  parseCron,
  previousRunAt,
  shouldSchedule,
  startPriceScheduler,
  stopPriceScheduler,
} from "./scheduler.ts";

// The real pass touches the database; here all that matters is that the
// scheduler calls it and that it survives the call failing.
const CLEAN_RUN = {
  checked: 3,
  skipped: 0,
  alerts: 0,
  notified: 0,
  failures: 0,
  pending: 0,
  telegramConfigured: true,
};
const runPriceCheck = vi.hoisted(() =>
  vi.fn(async (): Promise<Record<string, unknown>> => ({
    checked: 3,
    skipped: 0,
    alerts: 0,
    notified: 0,
    failures: 0,
    pending: 0,
    telegramConfigured: true,
  })),
);
// By default, a home with nothing tracked: that way startup fires no catch-up
// run and the timer tests measure only the timer.
const runHistory = vi.hoisted(() =>
  vi.fn(async (): Promise<{ activeProducts: number; lastCheckedAt: Date | null }> => ({
    activeProducts: 0,
    lastCheckedAt: null,
  })),
);
vi.mock("@/lib/price-service", () => ({ runPriceCheck, runHistory }));

const ORIGINAL = { ...process.env };

beforeEach(() => {
  process.env.APP_ORIGIN = "https://a.example";
  runPriceCheck.mockClear();
  runPriceCheck.mockImplementation(async () => ({ ...CLEAN_RUN }));
  runHistory.mockClear();
  runHistory.mockImplementation(async () => ({ activeProducts: 0, lastCheckedAt: null }));
});

afterEach(() => {
  stopPriceScheduler();
  vi.useRealTimers();
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL };
});

describe("scheduler", () => {
  it("schedules nothing when off", () => {
    process.env.PRICE_CHECK_CRON = "off";
    expect(shouldSchedule()).toBe(false);
  });

  it("schedules at eight by default", () => {
    delete process.env.PRICE_CHECK_CRON;
    expect(shouldSchedule()).toBe(true);
  });

  it("reads the hour in the TZ zone, not in UTC", () => {
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "Europe/Madrid";
    const from = new Date("2026-09-02T00:00:00Z");
    // Under mainland Spain's summer time, 08:00 local is 06:00 UTC.
    expect(nextRunAt(from).toISOString()).toBe("2026-09-02T06:00:00.000Z");
  });

  it("an unreadable expression stops startup instead of silently doing nothing", () => {
    process.env.PRICE_CHECK_CRON = "every day";
    expect(() => nextRunAt(new Date())).toThrow(/PRICE_CHECK_CRON/);
  });
});

describe("the time zone", () => {
  it("the same expression lands on different instants depending on TZ", () => {
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    const from = new Date("2026-09-02T00:00:00Z");

    process.env.TZ = "UTC";
    expect(nextRunAt(from).toISOString()).toBe("2026-09-02T08:00:00.000Z");

    process.env.TZ = "America/New_York";
    expect(nextRunAt(from).toISOString()).toBe("2026-09-02T12:00:00.000Z");

    process.env.TZ = "Asia/Tokyo";
    // Tokyo's 08:00 on the 2nd has already gone by at 00:00 UTC on the 2nd.
    expect(nextRunAt(from).toISOString()).toBe("2026-09-02T23:00:00.000Z");
  });

  it("with no TZ a container reasons in UTC", () => {
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    delete process.env.TZ;
    const from = new Date("2026-09-02T00:00:00Z");
    expect(nextRunAt(from).toISOString()).toBe("2026-09-02T08:00:00.000Z");
  });

  it("crosses the clock change without shifting the appointment", () => {
    // Madrid goes from UTC+2 to UTC+1 in the early hours of 25 October 2026.
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "Europe/Madrid";
    expect(nextRunAt(new Date("2026-10-24T08:00:00Z")).toISOString()).toBe(
      "2026-10-25T07:00:00.000Z",
    );
  });

  it("an hour that does not exist that day is skipped, not moved earlier or later", () => {
    // In the early hours of 28 March 2027 Madrid jumps from 02:00 to 03:00:
    // there is no 02:00 at all that day. An appointment at that hour has to
    // wait for the next day, which in UTC is 00:00 on the 29th.
    process.env.PRICE_CHECK_CRON = "0 2 * * *";
    process.env.TZ = "Europe/Madrid";
    expect(nextRunAt(new Date("2027-03-27T12:00:00Z")).toISOString()).toBe(
      "2027-03-29T00:00:00.000Z",
    );
  });

  it("a nonexistent TZ fails naming the variable", () => {
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "Marte/Olympus";
    expect(() => nextRunAt(new Date("2026-09-02T00:00:00Z"))).toThrow(/TZ/);
  });
});

describe("the cron subset that is accepted", () => {
  it("accepts the wildcard in minute and hour", () => {
    expect(parseCron("* * * * *").minutes).toHaveLength(60);
    expect(parseCron("* * * * *").hours).toHaveLength(24);
  });

  it("accepts plain integers", () => {
    expect(parseCron("30 6 * * *")).toEqual({ minutes: [30], hours: [6] });
  });

  it("accepts steps", () => {
    expect(parseCron("0 */6 * * *")).toEqual({ minutes: [0], hours: [0, 6, 12, 18] });
    expect(parseCron("*/15 8 * * *")).toEqual({ minutes: [0, 15, 30, 45], hours: [8] });
  });

  it("every six hours lands six hours later, not the next day", () => {
    process.env.PRICE_CHECK_CRON = "0 */6 * * *";
    process.env.TZ = "UTC";
    expect(nextRunAt(new Date("2026-09-02T07:13:00Z")).toISOString()).toBe(
      "2026-09-02T12:00:00.000Z",
    );
  });

  it("rejects ranges and lists, which are not implemented", () => {
    expect(() => parseCron("0 8-10 * * *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("0,30 8 * * *")).toThrow(/PRICE_CHECK_CRON/);
  });

  it("rejects day of month, month and day of week other than *", () => {
    expect(() => parseCron("0 8 1 * *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("0 8 * 3 *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("0 8 * * 1")).toThrow(/PRICE_CHECK_CRON/);
  });

  it("rejects out-of-range values", () => {
    expect(() => parseCron("60 8 * * *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("0 24 * * *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("*/0 8 * * *")).toThrow(/PRICE_CHECK_CRON/);
  });

  it("rejects a field count other than five", () => {
    expect(() => parseCron("0 8 * *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("0 8 * * * *")).toThrow(/PRICE_CHECK_CRON/);
    expect(() => parseCron("")).toThrow(/PRICE_CHECK_CRON/);
  });

  it("forgives extra spaces, which are a typing slip and not a different intent", () => {
    expect(parseCron("  0   8  *  *  * ")).toEqual({ minutes: [0], hours: [8] });
  });
});

describe("the timer", () => {
  it("with off it arms nothing", () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T00:00:00Z") });
    process.env.PRICE_CHECK_CRON = "off";
    startPriceScheduler();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fires the pass when the hour arrives", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T07:59:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";

    startPriceScheduler();
    expect(runPriceCheck).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(61_000);
    expect(runPriceCheck).toHaveBeenCalledTimes(1);
  });

  it("does not fire again until the next appointment", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T07:59:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(runPriceCheck).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(21 * 60 * 60 * 1000);
    expect(runPriceCheck).toHaveBeenCalledTimes(2);
  });

  it("if the pass blows up, it tries again tomorrow", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T07:59:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    runPriceCheck.mockRejectedValue(new Error("the database is not answering"));

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(runPriceCheck).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();

    // The timer is still alive: one bad day does not cancel the calendar.
    await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
    expect(runPriceCheck).toHaveBeenCalledTimes(2);
  });

  it("two starts do not stack two schedulers", () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T00:00:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";

    startPriceScheduler();
    const armed = vi.getTimerCount();
    startPriceScheduler();
    startPriceScheduler();
    expect(vi.getTimerCount()).toBe(armed);
  });

  it("an unreadable expression arms nothing and says so in the log", () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T00:00:00Z") });
    process.env.PRICE_CHECK_CRON = "every day";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    startPriceScheduler();

    expect(vi.getTimerCount()).toBe(0);
    expect(error.mock.calls.flat().join(" ")).toMatch(/PRICE_CHECK_CRON/);
  });
});

describe("the appointment that already went by", () => {
  it("previousRunAt looks backwards in the TZ zone", () => {
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "Europe/Madrid";
    // At 09:00 in Madrid, the 08:00 appointment has just gone by.
    expect(previousRunAt(new Date("2026-09-02T07:00:00Z")).toISOString()).toBe(
      "2026-09-02T06:00:00.000Z",
    );
    // At 07:00 in Madrid, the last one was yesterday's.
    expect(previousRunAt(new Date("2026-09-02T05:00:00Z")).toISOString()).toBe(
      "2026-09-01T06:00:00.000Z",
    );
  });

  it("a container that starts late catches up the pass it missed", async () => {
    // Restart in the early hours, first request at 09:00: the 08:00 appointment
    // went by with nobody listening, and nobody would have missed it.
    vi.useFakeTimers({ now: new Date("2026-09-02T09:00:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    runHistory.mockResolvedValue({
      activeProducts: 4,
      lastCheckedAt: new Date("2026-09-01T08:00:12Z"),
    });

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(runPriceCheck).toHaveBeenCalledTimes(1);
  });

  it("if today's pass already ran, it is not repeated at startup", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T09:00:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    runHistory.mockResolvedValue({
      activeProducts: 4,
      lastCheckedAt: new Date("2026-09-02T08:00:31Z"),
    });

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(runPriceCheck).not.toHaveBeenCalled();
  });

  it("starting BEFORE the appointment does not bring it forward", async () => {
    // What separates "catch up what was missed" from "check on every startup".
    vi.useFakeTimers({ now: new Date("2026-09-02T07:00:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    runHistory.mockResolvedValue({
      activeProducts: 4,
      lastCheckedAt: new Date("2026-09-01T08:00:07Z"),
    });

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(runPriceCheck).not.toHaveBeenCalled();
  });

  it("with no products tracked nothing is caught up", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T09:00:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    runHistory.mockResolvedValue({ activeProducts: 0, lastCheckedAt: null });

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(runPriceCheck).not.toHaveBeenCalled();
  });

  it("with off nothing is caught up either", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T09:00:00Z") });
    process.env.PRICE_CHECK_CRON = "off";
    runHistory.mockResolvedValue({ activeProducts: 4, lastCheckedAt: null });

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(runPriceCheck).not.toHaveBeenCalled();
    expect(runHistory).not.toHaveBeenCalled();
  });

  it("if the database does not answer, the calendar stays armed", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T09:00:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    runHistory.mockRejectedValue(new Error("the database is not up yet"));

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(0);

    expect(error).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
  });
});

describe("two passes at once", () => {
  it("an appointment that arrives with the previous one still running is skipped", async () => {
    // The grammar accepts "every minute" and a pass can take longer than one.
    // Two overlapping passes would read the same stale lastCheckedAt and alert
    // about the same price drop twice.
    vi.useFakeTimers({ now: new Date("2026-09-02T07:59:30Z") });
    process.env.PRICE_CHECK_CRON = "* * * * *";
    process.env.TZ = "UTC";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    runPriceCheck.mockImplementation(() => new Promise(() => {}));

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

    expect(runPriceCheck).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls.flat().join(" ")).toMatch(/previous pass is still running/);
  });

  it("once the previous one finishes, the next appointment fires again", async () => {
    vi.useFakeTimers({ now: new Date("2026-09-02T07:59:30Z") });
    process.env.PRICE_CHECK_CRON = "* * * * *";
    process.env.TZ = "UTC";

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runPriceCheck).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runPriceCheck).toHaveBeenCalledTimes(2);
  });
});

describe("what the log says when it finishes", () => {
  async function runWith(summary: Record<string, unknown>) {
    vi.useFakeTimers({ now: new Date("2026-09-02T07:59:00Z") });
    process.env.PRICE_CHECK_CRON = "0 8 * * *";
    process.env.TZ = "UTC";
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    runPriceCheck.mockResolvedValue({ ...CLEAN_RUN, ...summary });

    startPriceScheduler();
    await vi.advanceTimersByTimeAsync(61_000);
    return { info, warn };
  }

  it("a clean pass is a single info line", async () => {
    const { info, warn } = await runWith({});
    expect(info.mock.calls.flat().join(" ")).toMatch(/daily pass finished/);
    expect(warn).not.toHaveBeenCalled();
  });

  it("products that could not be read do not pass as info", async () => {
    const { warn } = await runWith({ checked: 40, failures: 40 });
    expect(warn.mock.calls.flat().join(" ")).toMatch(/40 product\(s\) could not be read/);
  });

  it("half the list left unchecked does not either", async () => {
    const { warn } = await runWith({ pending: 22 });
    expect(warn.mock.calls.flat().join(" ")).toMatch(/22 left unchecked/);
  });

  it("alerts that reach nobody do not either, and it says Telegram is not set up", async () => {
    const { warn } = await runWith({ alerts: 3, notified: 0, telegramConfigured: false });
    const text = warn.mock.calls.flat().join(" ");
    expect(text).toMatch(/3 of 3 alert\(s\) not delivered/);
    expect(text).toMatch(/Telegram is not configured/);
  });
});
