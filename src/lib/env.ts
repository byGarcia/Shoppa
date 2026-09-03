/**
 * The runtime contract, validated strictly.
 *
 * Every value here is read at request time rather than captured at module load:
 * the test suite rewrites `process.env` between cases, and `next build` imports
 * this module in an environment that has none of these set.
 *
 * A wrong value is refused rather than defaulted. Falling back to a default when
 * someone typed `AUTH_MODE=passkeys` would silently accept more than the
 * operator asked for, and that is exactly the failure nobody notices.
 *
 * Refused is NOT the same as "the container does not start". See assertEnv
 * below: it runs on the first request, not at boot, so a bad value here is an
 * instance that comes up `Up` and answers 500 to everything.
 */

const AUTH_MODES = ["auto", "passkey", "password"] as const;
const TRUSTED_PROXIES = ["none", "x-real-ip", "xff", "cloudflare"] as const;
const PRICE_FETCH_MODES = ["local", "assisted"] as const;

export type AuthMode = (typeof AUTH_MODES)[number];
export type TrustedProxy = (typeof TRUSTED_PROXIES)[number];
export type PriceFetchMode = (typeof PRICE_FETCH_MODES)[number];

class EnvError extends Error {}

function oneOf<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if ((allowed as readonly string[]).includes(raw)) return raw as T;
  throw new EnvError(`${name}: "${raw}" is not valid. Accepted values: ${allowed.join(", ")}.`);
}

/** The public origin of this instance. Authority on transport, cookies and CSRF. */
export function appOrigin(): URL {
  const raw = process.env.APP_ORIGIN;
  if (!raw) {
    throw new EnvError(
      "APP_ORIGIN is required: the public origin of this instance, " +
        'for example "http://192.168.1.50:3004" or "https://shopping.example.com".',
    );
  }
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new EnvError(`APP_ORIGIN: "${raw}" is not a URL.`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new EnvError(`APP_ORIGIN: the scheme "${url.protocol}" is not accepted; use http or https.`);
  }
  if (url.pathname !== "/" || url.search || url.hash) {
    throw new EnvError(`APP_ORIGIN: "${raw}" carries a path or a query; write only the origin.`);
  }
  return url;
}

/** True when the browser will treat this instance as a secure context. */
export function isSecureOrigin(): boolean {
  return appOrigin().protocol === "https:";
}

export function authMode(): AuthMode {
  return oneOf("AUTH_MODE", AUTH_MODES, "auto");
}

export function trustedProxy(): TrustedProxy {
  return oneOf("TRUSTED_PROXY", TRUSTED_PROXIES, "none");
}

export function priceFetchMode(): PriceFetchMode {
  return oneOf("PRICE_FETCH_MODE", PRICE_FETCH_MODES, "local");
}

/** A cron expression, or "off". Parsed for real in src/lib/scheduler.ts. */
export function priceCheckCron(): string {
  const raw = process.env.PRICE_CHECK_CRON;
  if (raw === undefined || raw === "") return "0 8 * * *";
  return raw;
}

/**
 * Called from bootOnce() in src/proxy.ts, on the first request — not at boot,
 * whatever the name suggests. Touches the five variables this file owns, so the
 * first bad one throws here rather than deep inside a handler.
 *
 * `priceCheckCron` is touched but not validated, on purpose: it only reads the
 * string. The expression is parsed in src/lib/scheduler.ts, and a bad one is
 * reported there instead of thrown here, because a schedule nobody can read is
 * not a reason to refuse to serve the shopping list. It is the only variable in
 * this file whose being wrong leaves the instance usable.
 *
 * WHAT IT DOES NOT COVER, because those variables are read elsewhere and this
 * function is not a registry of the whole environment:
 *
 *  - `AUTH_SECRET` — src/server/setup.ts and the WebAuthn challenge cookie.
 *    Missing, it throws per request in whatever needed it. While the instance
 *    is unclaimed that surfaces as a `[setup]` warning on the boot log, because
 *    printing the installation token is what asks for it first; once claimed,
 *    nothing asks until somebody tries to sign in.
 *  - `DATABASE_URL` — src/server/db.ts, on the first query.
 *  - `WEBAUTHN_RP_ID` / `WEBAUTHN_ORIGIN` — src/server/webauthn/config.ts.
 *    Defined-but-empty is fatal there, and "there" means the first passkey
 *    ceremony, not the boot.
 *  - `TZ` — read by src/lib/scheduler.ts when it computes the next run.
 *
 * Adding them here would be a bigger change than it looks: it would turn a bad
 * database URL or an unset secret into an instance that refuses every request,
 * including the login screen that would tell somebody what is wrong.
 */
export function assertEnv(): void {
  appOrigin();
  authMode();
  trustedProxy();
  priceFetchMode();
  priceCheckCron();
}
