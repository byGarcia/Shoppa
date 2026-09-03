/**
 * Which languages this installation speaks, and how a request picks one.
 *
 * There is no `[locale]` segment in the routes: a household shares one URL and
 * one bookmarked PWA, and putting `/es` in front of every path would break the
 * installed shortcuts and the Siri endpoints for the sake of a language switch
 * that each member flips once. The locale travels in a cookie instead.
 */
export const LOCALES = ["es", "en"] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * Spanish is the fallback because the deployed installation runs in Spanish and
 * an unrecognised `Accept-Language` must not silently change what the household
 * already reads.
 */
export const DEFAULT_LOCALE: Locale = "es";

/** Next.js' conventional name; also what a `<html lang>`-aware proxy expects. */
export const LOCALE_COOKIE = "NEXT_LOCALE";

/** A year: the choice is a preference, not a session. */
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: string | undefined | null): value is Locale {
  return value !== null && value !== undefined && (LOCALES as readonly string[]).includes(value);
}

/**
 * First supported language in an `Accept-Language` header, honouring q-values.
 * Region subtags are dropped: `es-419` and `es-ES` are both Spanish here.
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranked = header
    .split(",")
    .map((part) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.find((p) => p.trim().startsWith("q="));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((entry) => entry.tag.length > 0 && Number.isFinite(entry.q))
    .sort((a, b) => b.q - a.q);

  for (const { tag } of ranked) {
    const base = tag.split("-")[0];
    if (isLocale(base)) return base;
  }
  return null;
}
