"use client";

import { useLocale, useTranslations } from "next-intl";

import { LOCALES, LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE } from "@/i18n/locale";

/**
 * The language of the interface, for this browser.
 *
 * It writes the cookie the server reads (src/i18n/request.ts) and reloads,
 * rather than swapping a client-side provider: half of the copy is rendered on
 * the server — page titles, the API's own error messages — so a change that
 * never reaches the server would leave the screen speaking two languages.
 *
 * The choice is per browser, not per account: the household shares one
 * installation and its members do not have to agree on a language.
 */
export function LanguageSwitch() {
  const t = useTranslations("common");
  const locale = useLocale();

  const names: Record<string, string> = {
    es: t("spanish"),
    en: t("english"),
  };

  function choose(next: string): void {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE}; samesite=lax`;
    window.location.reload();
  }

  return (
    <div className="flex items-center gap-3.5 rounded-[18px] border border-line bg-surface px-4 py-4 shadow-[var(--e1)]">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[13px] bg-chip text-xl">
        🌍
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-bold text-ink">{t("language")}</span>
        <span className="mt-0.5 block text-xs font-medium text-muted">{names[locale]}</span>
      </span>
      <select
        aria-label={t("languageHint")}
        value={locale}
        onChange={(e) => choose(e.target.value)}
        className="shrink-0 rounded-lg border border-line bg-bg px-2.5 py-2 text-sm font-semibold text-ink outline-none"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code}>
            {names[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
