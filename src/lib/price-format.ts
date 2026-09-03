/**
 * Client-safe price formatting. price-service.ts has its own copy on purpose:
 * that module imports Prisma and can never be pulled into a client bundle.
 *
 * Nothing here returns a sentence. Where a value has to be named — how a price
 * was detected, how long ago it was read — the function returns the catalog key
 * and the numbers, and the component that has a translator turns them into
 * words. A `src/lib` module that carried Spanish would have to carry English
 * next to it, and then the two would drift.
 */

export function formatMoney(value: number, currency = "EUR", locale = "es-ES"): string {
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency }).format(value);
  } catch {
    return `${new Intl.NumberFormat(locale, { minimumFractionDigits: 2 }).format(value)} ${currency}`;
  }
}

/** Signed percentage change from `base` to `current`, rounded. */
export function percentChange(base: number, current: number): number {
  if (base <= 0) return 0;
  return Math.round(((current - base) / base) * 100);
}

/** Where a price was detected, as a key under `prices.source`. */
export function sourceKey(source: string | null): string {
  switch (source) {
    case "json-ld":
    case "microdata":
    case "open-graph":
    case "domain":
      return source;
    default:
      return "auto";
  }
}

export type RelativeDay =
  | { kind: "never" }
  | { kind: "today" }
  | { kind: "yesterday" }
  | { kind: "daysAgo"; days: number }
  | { kind: "date"; date: Date };

/**
 * How long ago a price was read. A month or more turns into a date, which is
 * the one case the caller formats with Intl instead of the catalog.
 */
export function relativeDay(iso: string | null): RelativeDay {
  if (!iso) return { kind: "never" };
  const date = new Date(iso);
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return { kind: "today" };
  if (days === 1) return { kind: "yesterday" };
  if (days < 30) return { kind: "daysAgo", days };
  return { kind: "date", date };
}
