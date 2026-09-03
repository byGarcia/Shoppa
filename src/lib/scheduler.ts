/**
 * The daily price run, fired from inside the application.
 *
 * Price tracking is the reason to choose this over any other shopping list, and
 * until now it only happened because something outside the container poked
 * `POST /api/prices/check` once a day. Documenting that endpoint does not make
 * anything happen: a fresh install would track prices that never get checked.
 * So the server keeps its own clock.
 *
 * No cron dependency. The expression this product has any business offering is
 * "once a day at a fixed time", and a hand-written parser for that subset is
 * fifty lines that never need a security advisory. What it does NOT accept, it
 * refuses by name — see parseCron — because a schedule that silently never
 * fires is indistinguishable from a broken feature.
 *
 * The clock is the one in `TZ`, not the process's idea of local time. A
 * container is UTC unless told otherwise, and "eight in the morning" quietly
 * meaning nine or ten is the kind of bug nobody reports.
 */

import { priceCheckCron } from "@/lib/env";

/** The minutes and hours of the day this instance is due to run. */
export type CronSchedule = { minutes: number[]; hours: number[] };

class CronError extends Error {}

/**
 * How far ahead to look for the next matching minute.
 *
 * Day-of-month, month and day-of-week are pinned to `*`, so every accepted
 * expression repeats within 24 h; two days of slack covers the longest gap plus
 * any daylight-saving jump. A bound at all is what turns "no minute matches"
 * into an error instead of an infinite loop.
 */
const LOOKAHEAD_MINUTES = 2 * 24 * 60;

/**
 * Never sleep longer than this in one go.
 *
 * A single `setTimeout` of up to 24 h would be correct only if the process's
 * clock advanced exactly with the wall one. It does not: a host that suspends,
 * an NTP correction or a timezone database update all move the target while the
 * timer counts down. Waking every quarter of an hour to re-check costs nothing
 * and means the worst a clock jump can do is delay the run by fifteen minutes.
 */
const MAX_SLEEP_MS = 15 * 60 * 1000;

const MINUTE_MS = 60_000;

type SchedulerState = {
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Epoch ms of the next due run. Moved BEFORE running, never after. */
  nextAt: number;
  /** A pass is in flight. Guards against two of them overlapping. */
  running: boolean;
};

/**
 * The running scheduler, parked on `globalThis` rather than in module scope.
 *
 * Module scope is not once per process here. `next dev` re-evaluates a module on
 * every hot reload, and Next compiles the proxy/middleware bundle separately
 * from the route bundles, so the same source file can be instantiated more than
 * once inside one Node process — each instance with its own module-level
 * variables and none of them able to see the others. A guard living there would
 * be a guard per copy, and a guard per copy is no guard: two timers, two runs,
 * two Telegram alerts for the same price drop. `globalThis` is shared by every
 * copy in the process, so the first one to arrive wins and the rest are no-ops.
 */
const SCHEDULER_KEY = "__shoppaPriceScheduler";
const globalForScheduler = globalThis as typeof globalThis & {
  [SCHEDULER_KEY]?: SchedulerState;
};

function range(min: number, max: number): number[] {
  const out: number[] = [];
  for (let value = min; value <= max; value++) out.push(value);
  return out;
}

function parseField(raw: string, min: number, max: number, field: string): number[] {
  if (raw === "*") return range(min, max);

  const step = /^\*\/(\d+)$/.exec(raw);
  if (step) {
    const every = Number(step[1]);
    if (every < 1 || every > max - min + 1) {
      throw new CronError(
        `PRICE_CHECK_CRON: the step "${raw}" in the ${field} field is out of range (1-${max - min + 1}).`,
      );
    }
    return range(min, max).filter((value) => (value - min) % every === 0);
  }

  if (/^\d+$/.test(raw)) {
    const value = Number(raw);
    if (value < min || value > max) {
      throw new CronError(
        `PRICE_CHECK_CRON: the ${field} field is "${raw}" and only accepts ${min} to ${max}.`,
      );
    }
    return [value];
  }

  throw new CronError(
    `PRICE_CHECK_CRON: "${raw}" is not understood in the ${field} field. ` +
      'Accepted: "*", a number, or "*/n". No lists and no ranges.',
  );
}

/**
 * The five-field expression, or a throw that names the variable.
 *
 * Accepted in minute and hour: the wildcard, an integer, and a step written as
 * a wildcard followed by a slash and a number. Day-of-month, month and
 * day-of-week must be the wildcard and nothing else. That covers `0 8 . . .`,
 * `30 6 . . .` and every-six-hours, which is every schedule a household
 * shopping list needs.
 * Ranges (`8-10`), lists (`0,30`), names (`MON`) and the `@daily` shorthands
 * are refused rather than half-supported: accepting the syntax and ignoring
 * part of its meaning is how a run ends up firing at a time nobody chose.
 */
export function parseCron(expression: string): CronSchedule {
  const fields = expression.trim().split(/\s+/).filter(Boolean);
  if (fields.length !== 5) {
    throw new CronError(
      `PRICE_CHECK_CRON: "${expression}" is not five fields ` +
        '(minute hour day-of-month month day-of-week), for example "0 8 * * *".',
    );
  }

  const [minute, hour, ...rest] = fields;
  const restNames = ["day-of-month", "month", "day-of-week"];
  for (let index = 0; index < rest.length; index++) {
    if (rest[index] !== "*") {
      throw new CronError(
        `PRICE_CHECK_CRON: the ${restNames[index]} field is "${rest[index]}" and only "*" is accepted here. ` +
          "This application schedules by time of day, not by date.",
      );
    }
  }

  return {
    minutes: parseField(minute, 0, 59, "minute"),
    hours: parseField(hour, 0, 23, "hour"),
  };
}

/**
 * The timezone the expression is read in: `TZ`, or UTC when it is not set.
 *
 * UTC and not the host's zone on purpose. `TZ` unset means nobody stated an
 * intent, and a container's answer to that question is UTC — so the schedule
 * means the same thing on the maintainer's laptop as in the image, and the way
 * to change it is to say so.
 */
function timeZone(): string {
  const raw = process.env.TZ;
  const zone = raw !== undefined && raw !== "" ? raw : "UTC";
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: zone }).resolvedOptions().timeZone;
  } catch {
    throw new CronError(`TZ: "${zone}" is not a known time zone (for example Europe/Madrid).`);
  }
}

/** Wall-clock hour and minute of `instant` as read in `zone`. */
function wallClock(formatter: Intl.DateTimeFormat, instant: Date): { hour: number; minute: number } {
  let hour = -1;
  let minute = -1;
  for (const part of formatter.formatToParts(instant)) {
    if (part.type === "hour") hour = Number(part.value);
    else if (part.type === "minute") minute = Number(part.value);
  }
  return { hour, minute };
}

/**
 * The first instant strictly after `from` whose wall clock in `TZ` matches.
 *
 * Minute by minute rather than by arithmetic on the offset, because the offset
 * is not a constant: it changes twice a year, and it changes by something other
 * than an hour in more places than one expects. Walking real instants and
 * asking `Intl` what the clock on the wall says is the only version that is
 * right during a daylight-saving change — an 08:00 that does not exist that day
 * is skipped instead of firing at 09:00.
 *
 * Strictly after, so a scheduler that wakes exactly on its own appointment
 * cannot re-arm for the same instant and spin.
 */
export function nextRunAt(from: Date): Date {
  return scan(from, +1);
}

/**
 * The most recent instant at or before `from` whose wall clock in `TZ` matches:
 * the appointment that has already gone by.
 *
 * Only the catch-up uses it, and only to ask "did that one happen?".
 */
export function previousRunAt(from: Date): Date {
  return scan(from, -1);
}

/** Walk minute by minute in `direction` until the wall clock matches. */
function scan(from: Date, direction: 1 | -1): Date {
  const schedule = parseCron(priceCheckCron());
  const zone = timeZone();
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });

  const minutes = new Set(schedule.minutes);
  const hours = new Set(schedule.hours);
  // Forwards starts on the NEXT minute (strictly after); backwards starts on
  // the current one, because an appointment happening right now has passed.
  const start = Math.floor(from.getTime() / MINUTE_MS) * MINUTE_MS + (direction === 1 ? MINUTE_MS : 0);

  for (let step = 0; step < LOOKAHEAD_MINUTES; step++) {
    const candidate = new Date(start + direction * step * MINUTE_MS);
    const { hour, minute } = wallClock(formatter, candidate);
    if (hours.has(hour) && minutes.has(minute)) return candidate;
  }

  // Unreachable with the grammar above: day-of-month, month and day-of-week are
  // pinned to `*`, so every accepted expression has an appointment within 24 h
  // and the window is two days. It stands as the thing that fails loudly rather
  // than looping if that grammar is ever widened.
  throw new CronError(
    `PRICE_CHECK_CRON: "${priceCheckCron()}" has no appointment within the two days that are searched.`,
  );
}

/** False only when the operator turned it off. Everything else is a schedule. */
export function shouldSchedule(): boolean {
  return priceCheckCron().trim().toLowerCase() !== "off";
}

/**
 * One pass. Never throws and never rejects.
 *
 * A rejection escaping here becomes an unhandled rejection, which Node ends the
 * process over by default — one shop timing out at eight in the morning would
 * take the whole instance down. A bad night is logged and the calendar stands.
 *
 * The import is dynamic so that price-service (and through it Prisma) is only
 * evaluated when a run actually happens: this module is reached from the proxy,
 * which is loaded on every cold start and during `next build`.
 */
async function runOnce(): Promise<void> {
  try {
    const { runPriceCheck } = await import("@/lib/price-service");
    const summary = await runPriceCheck();

    // A summary is not a verdict. runPriceCheck swallows every per-product
    // error into a counter, so a night where all forty products failed, or
    // where every alert went nowhere because Telegram is not configured, or
    // where the time budget left half the list unchecked, comes back as a
    // perfectly ordinary object. Printed at info it is one line
    // indistinguishable from success, and on an unattended machine the log is
    // the only instrument there is.
    const wrong: string[] = [];
    if (summary.failures > 0) wrong.push(`${summary.failures} product(s) could not be read`);
    if (summary.pending > 0) wrong.push(`${summary.pending} left unchecked for lack of time`);
    if (summary.alerts > 0 && summary.notified < summary.alerts) {
      wrong.push(
        `${summary.alerts - summary.notified} of ${summary.alerts} alert(s) not delivered` +
          (summary.telegramConfigured ? "" : " (Telegram is not configured)"),
      );
    }

    if (wrong.length > 0) {
      console.warn(`[prices] pass finished with problems: ${wrong.join("; ")}.`, summary);
    } else {
      console.info("[prices] daily pass finished:", summary);
    }
  } catch (error) {
    console.error("[prices] the daily pass failed; it is retried at the next appointment:", error);
  }
}

/**
 * Start a pass unless one is still going.
 *
 * The grammar accepts every-minute expressions and a pass can outlive a minute
 * (a 55-second budget plus one more batch), so without this two passes overlap,
 * both read the same still-stale `lastCheckedAt`, re-check the same products
 * and RE-ALERT them. That is the duplicate Telegram message the `globalThis`
 * guard exists to prevent, arriving through a second door.
 *
 * runOnce never rejects, so the flag always comes back down.
 */
function fire(state: SchedulerState): void {
  if (state.running) {
    console.warn("[prices] the previous pass is still running; this appointment is skipped.");
    return;
  }
  state.running = true;
  void runOnce()
    // runOnce is written not to reject, and this is the belt for that brace: an
    // unhandled rejection escaping a timer callback is an unhandled rejection in
    // the server process, which is a crash rather than a skipped price run.
    .catch((error) => {
      console.error("[prices] the pass failed unexpectedly:", error);
    })
    .finally(() => {
      state.running = false;
    });
}

/**
 * Run now if the appointment that already went by never happened.
 *
 * The scheduler only arms when the proxy handles its first request, and
 * `nextRunAt` only ever looks forward. So a container that restarts overnight —
 * host reboot, image auto-update, a restart after an OOM — and then sees no
 * traffic until after eight skips that day in complete silence, and on a host
 * that reboots nightly it never runs at all.
 *
 * The question asked is deliberately narrow: not "has anything been checked
 * today" but "has anything been checked since the last appointment". Booting at
 * seven with the appointment at eight must NOT drag the run an hour early;
 * booting at nine having missed the eight o'clock one must catch it. Products
 * write `lastCheckedAt` on failure as well as on success, so the mark is there
 * whatever the night produced.
 */
async function catchUpIfMissed(state: SchedulerState): Promise<void> {
  try {
    const due = previousRunAt(new Date());
    const { runHistory } = await import("@/lib/price-service");
    const history = await runHistory();

    if (history.activeProducts === 0) return;
    if (history.lastCheckedAt !== null && history.lastCheckedAt.getTime() >= due.getTime()) return;

    console.warn(
      `[prices] the ${due.toISOString()} appointment never ran ` +
        "(a later boot?); catching up now.",
    );
    fire(state);
  } catch (error) {
    console.error("[prices] could not check whether a pass was left pending:", error);
  }
}

function arm(state: SchedulerState): void {
  const wait = Math.min(Math.max(state.nextAt - Date.now(), 0), MAX_SLEEP_MS);
  state.timer = setTimeout(() => {
    if (Date.now() >= state.nextAt) {
      // The appointment moves BEFORE the run starts. A pass that outlives its
      // own minute would otherwise still be due when the next tick looks.
      try {
        state.nextAt = nextRunAt(new Date()).getTime();
      } catch (error) {
        console.error("[prices] the schedule stopped being readable; stopping:", error);
        stopPriceScheduler();
        return;
      }
      fire(state);
    }
    arm(state);
  }, wait);
  // The HTTP server is what keeps this process alive; the scheduler must not.
  // Otherwise `next build` and the test runner hang on a timer nobody awaits.
  state.timer.unref?.();
}

/**
 * Start the in-process scheduler. Idempotent, and best effort by design.
 *
 * Called after `booted = true` in the proxy: `booted` means "the configuration
 * is valid", and a missing price run does not make the instance down. So an
 * unreadable expression is reported at full volume and the instance keeps
 * serving, rather than turning every request into a 500 over a schedule.
 *
 * Arming is only half of it. Because this happens on the first request and not
 * at process start, the appointment may already be behind us by the time
 * anybody knocks — so the last one is checked and recovered. See
 * catchUpIfMissed.
 */
export function startPriceScheduler(): void {
  if (globalForScheduler[SCHEDULER_KEY]) return;
  if (!shouldSchedule()) {
    console.info("[prices] PRICE_CHECK_CRON=off: there is no automatic daily pass.");
    return;
  }

  let nextAt: number;
  try {
    nextAt = nextRunAt(new Date()).getTime();
  } catch (error) {
    console.error(
      "[prices] the daily pass could not be scheduled, so there will NOT be one:",
      error instanceof Error ? error.message : error,
    );
    return;
  }

  const state: SchedulerState = { timer: undefined, nextAt, running: false };
  globalForScheduler[SCHEDULER_KEY] = state;
  console.info(`[prices] next price pass: ${new Date(nextAt).toISOString()}`);
  arm(state);
  void catchUpIfMissed(state);
}

/** Cancel it. For the test suite and for a hot reload that wants a clean start. */
export function stopPriceScheduler(): void {
  const state = globalForScheduler[SCHEDULER_KEY];
  if (!state) return;
  if (state.timer) clearTimeout(state.timer);
  delete globalForScheduler[SCHEDULER_KEY];
}
