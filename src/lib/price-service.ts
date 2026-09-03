/**
 * Server-side price checking: read a product page, apply the sanity guard,
 * persist the reading and decide whether Telegram gets a message.
 *
 * The alert rule is deliberately tiny:
 *
 *   price < basePrice && !alertActive  -> notify, alertActive = true
 *   price >= basePrice                 -> alertActive = false
 *
 * so a product that stays cheap for a week buzzes once, not seven times.
 */

import { prisma, type TrackedProduct } from "@/server/db";
import { fetchProductHtml } from "./price-fetch";
import { extractPriceCandidates, pickCandidate } from "./price-extract";
import { escapeHtml, isTelegramConfigured, sendTelegram } from "./telegram";
import { apiText, serverLocale, serverTranslations } from "@/lib/api-messages";

/** A reading further than this from the reference price is not believed. */
const SANITY_FACTOR = 10;
/** Consecutive failures before the "I can't read this" message is sent. */
const FAIL_NOTIFY_THRESHOLD = 3;
/** Pages fetched at once during the daily run. */
const BATCH_SIZE = 4;
/** Leaves room under the platform's request timeout; the rest waits for tomorrow. */
const RUN_TIME_BUDGET_MS = 55_000;

export type CheckStatus = "ok" | "alerted" | "failed" | "skipped";

export type CheckOutcome = {
  productId: string;
  status: CheckStatus;
  price?: number;
  reason?: string;
  /**
   * Whether the Telegram message actually left, for `status: "alerted"`.
   * Reported because `sendTelegram` is a deliberate no-op when the bot is not
   * configured: without this, a run says "alerts: 1" whether the notification
   * went out or vanished, and the gap only surfaces the day a real price drops.
   */
  notified?: boolean;
  /**
   * The message the CALLER must deliver, when `deferNotify` is set. Used by the
   * ingest endpoint: an assisted-mode fetcher can hold the bot token inside its
   * own network, so the app decides *whether* to alert and the fetcher does the
   * sending — the same split as the fetching. That way the token never has to
   * be copied onto the server.
   */
  telegram?: string;
};

export type NotifyOptions = {
  /** Return the message instead of sending it (the caller delivers). */
  deferNotify?: boolean;
};

// ============================================================================
// FORMATTING
// ============================================================================

export function formatPrice(value: number, currency: string, locale = "es-ES"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    // Unknown currency code from a shop's JSON-LD must not break the message.
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}

function formatDay(date: Date, locale = "es-ES"): string {
  return new Intl.DateTimeFormat(locale, { day: "2-digit", month: "2-digit" }).format(date);
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Active products not yet checked today (UTC), oldest first — the work list an
 * assisted-mode fetcher pulls from `GET /api/prices/queue`. Same due-filter the
 * local run uses, kept here so both agree on "already done today".
 */
export async function listDueProducts(): Promise<Array<{ id: string; url: string }>> {
  const now = new Date();
  const products = await prisma.trackedProduct.findMany({
    where: { isActive: true },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
    select: { id: true, url: true, lastCheckedAt: true },
  });
  return products
    .filter((p) => p.lastCheckedAt === null || !isSameUtcDay(p.lastCheckedAt, now))
    .map((p) => ({ id: p.id, url: p.url }));
}

/**
 * How many products are being tracked, and when any of them was last read.
 *
 * One aggregate, for the scheduler's catch-up question: "did the appointment
 * that has already passed actually happen?". `lastCheckedAt` is written by both
 * the success and the failure paths, so a run that happened leaves a mark
 * whatever came of it — which is what makes it usable as a run marker without
 * adding a table for one timestamp.
 */
export async function runHistory(): Promise<{ activeProducts: number; lastCheckedAt: Date | null }> {
  const row = await prisma.trackedProduct.aggregate({
    where: { isActive: true },
    _count: { _all: true },
    _max: { lastCheckedAt: true },
  });
  return { activeProducts: row._count._all, lastCheckedAt: row._max.lastCheckedAt };
}

// ============================================================================
// SINGLE PRODUCT CHECK
// ============================================================================

async function recordFailure(
  product: TrackedProduct,
  reason: string,
  opts: NotifyOptions = {},
): Promise<CheckOutcome> {
  const failCount = product.failCount + 1;
  const shouldNotify = failCount >= FAIL_NOTIFY_THRESHOLD && !product.failNotified;

  await prisma.trackedProduct.update({
    where: { id: product.id },
    data: {
      failCount,
      lastError: reason.slice(0, 300),
      lastCheckedAt: new Date(),
      failNotified: shouldNotify ? true : product.failNotified,
    },
  });

  const outcome: CheckOutcome = { productId: product.id, status: "failed", reason };
  if (!shouldNotify) return outcome;

  const t = await serverTranslations("api.notify");
  const message = [
    // "<emoji> <source> — …": the chat this bot posts to may carry alerts from
    // other things too, and the source tag is what makes a mixed channel
    // triageable at a glance.
    t.markup("unreadable", { name: escapeHtml(product.title), b: (chunks) => `<b>${chunks}</b>` }),
    t("unreadableBody", { attempts: failCount, reason: escapeHtml(reason) }),
    product.url,
  ].join("\n");

  if (opts.deferNotify) return { ...outcome, telegram: message };
  const sent = await sendTelegram(message);
  return { ...outcome, notified: sent.ok };
}

/**
 * The HTML to process for a product: either a page body (fetched wherever — by
 * this host, or by an assisted-mode fetcher and POSTed to the ingest endpoint)
 * or a fetch failure to record.
 */
export type ProductHtml = { html: string; finalUrl?: string } | { error: string };

/**
 * Extract the price from already-fetched HTML and apply the alert rule. Never
 * throws: every failure path ends in a recorded reason, because a thrown error
 * inside the daily run would silently drop the remaining products of its batch.
 *
 * This is the half of a check that does NOT touch the network, so it runs
 * identically whether this host fetched the page or an assisted fetcher did.
 */
export async function processProductHtml(
  product: TrackedProduct,
  input: ProductHtml,
  opts: NotifyOptions = {},
): Promise<CheckOutcome> {
  if ("error" in input) return recordFailure(product, input.error, opts);

  const basePrice = Number(product.basePrice);
  const { candidates } = extractPriceCandidates(input.html, product.url);
  // Return to the source the reference price came from, and within it take the
  // reading nearest the reference — that is the offer, not a struck-out RRP.
  // If the hinted source vanished, pickCandidate falls back to all candidates.
  const chosen = pickCandidate(candidates, {
    source: product.priceHintSource,
    target: basePrice,
  });
  if (!chosen) {
    return recordFailure(product, await apiText("prices.noPriceFound"), opts);
  }

  const price = chosen.price;

  // Sanity guard: this is what stops a captcha page whose only number is an
  // accessory's 12,99 € from firing a "huge drop!" alert.
  if (price <= 0 || price > basePrice * SANITY_FACTOR || price < basePrice / SANITY_FACTOR) {
    return recordFailure(
      product,
      await apiText("notify.outOfRange", {
        price: formatPrice(price, product.currency, await serverLocale()),
      }),
      opts,
    );
  }

  const now = new Date();
  const previousLowest = product.lowestPrice === null ? null : Number(product.lowestPrice);
  const isNewLowest = previousLowest === null || price < previousLowest;
  const shouldAlert = price < basePrice && !product.alertActive;

  await prisma.$transaction([
    prisma.priceCheck.create({ data: { productId: product.id, price } }),
    prisma.trackedProduct.update({
      where: { id: product.id },
      data: {
        currentPrice: price,
        lastCheckedAt: now,
        failCount: 0,
        failNotified: false,
        lastError: null,
        alertActive: price < basePrice,
        ...(isNewLowest ? { lowestPrice: price, lowestAt: now } : {}),
      },
    }),
  ]);

  if (!shouldAlert) return { productId: product.id, status: "ok", price };

  const drop = Math.round(((basePrice - price) / basePrice) * 100);
  const lowest = isNewLowest ? price : (previousLowest as number);
  const lowestSince = isNewLowest ? now : (product.lowestAt ?? now);

  const t = await serverTranslations("api.notify");
  const locale = await serverLocale();
  const message = [
    t.markup("drop", { name: escapeHtml(product.title), b: (chunks) => `<b>${chunks}</b>` }),
    t("dropBody", {
      price: formatPrice(price, product.currency, locale),
      before: formatPrice(basePrice, product.currency, locale),
      drop,
    }),
    t("minimumSince", {
      date: formatDay(lowestSince, locale),
      price: formatPrice(lowest, product.currency, locale),
    }),
    product.url,
  ].join("\n");

  // Deferred: the caller — which may hold the bot token — delivers it.
  if (opts.deferNotify) {
    return { productId: product.id, status: "alerted", price, telegram: message };
  }

  const sent = await sendTelegram(message);
  if (!sent.ok) {
    // A drop that is detected but never announced is worse than not detecting
    // it: it creates the feeling of being watched without being watched. Loud.
    console.error(`[prices] drop detected but the alert did NOT go out: ${sent.reason}`);
  }
  return { productId: product.id, status: "alerted", price, notified: sent.ok };
}

/**
 * Fetch a product on THIS host and process it. The daily run in `local` mode,
 * the manual "check now" button, and the fallback when an assisted fetcher does
 * not answer. In `assisted` mode the fetcher instead POSTs the page to the
 * ingest endpoint, which calls processProductHtml directly.
 */
export async function checkProduct(product: TrackedProduct): Promise<CheckOutcome> {
  // Same rule as the preview: a page without a price means this host was fobbed
  // off, so fetchProductHtml retries it through the home agent.
  const fetched = await fetchProductHtml(product.url, {
    isUsable: (html) => extractPriceCandidates(html, product.url).candidates.length > 0,
  });
  return processProductHtml(
    product,
    fetched.ok ? { html: fetched.html, finalUrl: fetched.finalUrl } : { error: fetched.message },
  );
}

// ============================================================================
// DAILY RUN
// ============================================================================

export type RunSummary = {
  checked: number;
  skipped: number;
  alerts: number;
  /** Of those alerts, how many actually reached Telegram. */
  notified: number;
  failures: number;
  pending: number;
  /**
   * Whether the bot is configured at all. Surfaced in the response so the state
   * of the notification channel can be checked with the API key, instead of
   * depending on somebody pressing the test button in the UI — and so a run
   * that alerts into the void is visible rather than silent.
   */
  telegramConfigured: boolean;
};

/**
 * The daily pass. Idempotency is per product (`lastCheckedAt`), not per run:
 * re-firing the cron retries only what failed instead of re-notifying
 * everything, and whatever does not fit in the time budget is picked up by the
 * next pass because the state lives in the row, not in memory.
 */
export async function runPriceCheck(options: { force?: boolean } = {}): Promise<RunSummary> {
  const startedAt = Date.now();
  const now = new Date();

  const products = await prisma.trackedProduct.findMany({
    where: { isActive: true },
    orderBy: { lastCheckedAt: { sort: "asc", nulls: "first" } },
  });

  const summary: RunSummary = {
    checked: 0,
    skipped: 0,
    alerts: 0,
    notified: 0,
    failures: 0,
    pending: 0,
    telegramConfigured: isTelegramConfigured(),
  };
  const due: TrackedProduct[] = [];

  for (const product of products) {
    const alreadyToday =
      !options.force && product.lastCheckedAt !== null && isSameUtcDay(product.lastCheckedAt, now);
    if (alreadyToday) summary.skipped += 1;
    else due.push(product);
  }

  for (let index = 0; index < due.length; index += BATCH_SIZE) {
    if (Date.now() - startedAt > RUN_TIME_BUDGET_MS) {
      summary.pending = due.length - index;
      break;
    }
    const batch = due.slice(index, index + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map((product) => checkProduct(product)));

    for (const result of results) {
      if (result.status === "rejected") {
        // checkProduct swallows its own errors, so this is a DB/runtime fault.
        console.error("[prices] unexpected failure while checking a product:", result.reason);
        summary.failures += 1;
        continue;
      }
      summary.checked += 1;
      if (result.value.status === "alerted") {
        summary.alerts += 1;
        if (result.value.notified) summary.notified += 1;
      }
      if (result.value.status === "failed") summary.failures += 1;
    }
  }

  return summary;
}
