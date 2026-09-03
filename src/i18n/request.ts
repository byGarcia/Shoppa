import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";

import { DEFAULT_LOCALE, LOCALE_COOKIE, isLocale, localeFromAcceptLanguage } from "./locale";

/**
 * The locale for this request: an explicit choice first, then what the browser
 * asks for, then Spanish. Read per request rather than baked at build time, for
 * the same reason AUTH_MODE is: one image serves every installation.
 */
export default getRequestConfig(async () => {
  const cookieLocale = (await cookies()).get(LOCALE_COOKIE)?.value;
  const locale = isLocale(cookieLocale)
    ? cookieLocale
    : (localeFromAcceptLanguage((await headers()).get("accept-language")) ?? DEFAULT_LOCALE);

  return {
    locale,
    messages: (await import(`../../messages/${locale}.json`)).default,
  };
});
