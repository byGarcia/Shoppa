import { createTranslator } from "next-intl";
import { getLocale, getTranslations } from "next-intl/server";

import es from "../../messages/es.json";
import { DEFAULT_LOCALE } from "@/i18n/locale";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-policy";

/**
 * Server-side copy, for code that may or may not be inside a request.
 *
 * These sentences reach a person: `fetchJson` puts the response body's `error`
 * field straight into a toast, the entry screens print it under the form, and
 * the Siri routes hand theirs to the Shortcut to read out. So they are copy,
 * and copy lives in the catalog.
 *
 * The catalog is per request, because the language is — and `getTranslations`
 * only works where `cookies()` does. Two callers are outside that: the Vitest
 * suite, which drives the route handlers directly, and any future work queued
 * off a request. Both fall back to the default catalog rather than throwing a
 * 500 over a label, which is also the honest answer: with no request there is
 * no reader to have a preference.
 *
 * It sits in a module of its own — rather than in api-utils, where it is used
 * most — because the WebAuthn handlers need it too and api-utils reaches
 * `src/lib/auth.ts`, which reaches back into `src/server/webauthn`. Importing
 * api-utils from a handler would close that ring.
 */
type Translator = Awaited<ReturnType<typeof getTranslations>>;

export async function serverTranslations(namespace: string): Promise<Translator> {
  try {
    return await getTranslations(namespace as never);
  } catch (error) {
    // Say so. The expected cause is "there is no request here" — the Vitest
    // suite drives the route handlers directly — but the same catch would
    // swallow a broken catalog or a misconfigured plugin and turn it into
    // "everyone silently gets Spanish", which is the kind of failure that
    // survives a release.
    console.warn(
      `[i18n] falling back to the ${DEFAULT_LOCALE} catalog for "${namespace}":`,
      error instanceof Error ? error.message : error,
    );
    return createTranslator({
      locale: DEFAULT_LOCALE,
      messages: es,
      namespace: namespace as never,
    }) as Translator;
  }
}

/** The request's locale, or the default when there is no request. */
export async function serverLocale(): Promise<string> {
  try {
    return await getLocale();
  } catch (error) {
    console.warn(
      `[i18n] falling back to ${DEFAULT_LOCALE}:`,
      error instanceof Error ? error.message : error,
    );
    return DEFAULT_LOCALE;
  }
}

/** One message from the `api` namespace. */
export async function apiText(key: string, values?: Record<string, string>): Promise<string> {
  const t = await serverTranslations("api");
  return t(key as never, values as never);
}

/**
 * Zod carries its message as a plain string, so the schemas in
 * src/lib/validations.ts hold catalog keys instead of Spanish and this turns
 * them back into words. Anything that is not one of our keys — Zod's own
 * built-in messages about lengths and types — passes through untouched rather
 * than being swallowed.
 */
export async function translateIssue(message: string | undefined): Promise<string | undefined> {
  if (!message) return undefined;
  const t = await serverTranslations("api");
  // The values bag is unconditional, and ICU ignores what a message does not
  // use, so this costs nothing for the other keys. It is here because a Zod
  // issue is a bare string: the schema that raised it is long gone by the time
  // this runs, so there is nowhere else to say what `{min}` means. The
  // alternative was spelling "12" in both catalogs, which is how the copy ends
  // up contradicting the number the code actually enforces.
  return t.has(message as never) ? t(message as never, ISSUE_VALUES as never) : message;
}

const ISSUE_VALUES = { min: MIN_PASSWORD_LENGTH };
