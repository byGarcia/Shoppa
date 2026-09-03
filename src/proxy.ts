import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { appOrigin, assertEnv, trustedProxy } from "@/lib/env";
import { checkRouteCeiling } from "@/lib/login-throttle";
import { startPriceScheduler } from "@/lib/scheduler";
import { hstsHeader } from "@/lib/transport";
import { isClaimed, setupToken } from "@/server/setup";
import { clientIPFromHeaders } from "@/server/webauthn/client-ip";

const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = 100;
const STRICT_RATE_LIMIT_MAX = 5;
// Per-route exceptions to that five. A limit sized for "how many guesses" has to
// know how many requests one honest attempt costs, and the passkey registration
// ceremony now costs three: presence, options, verify. Five refuses the first
// retry — and it refuses it at ?step=verify, AFTER the authenticator prompt has
// run, so the user gets Face ID and then an error. Twelve is four whole attempts
// a minute per address, still hostile to the two secrets this route accepts (the
// installation token and, from settings, the current password) and both of those
// are bounded again by the per-account throttle, which reauthenticate.ts now
// consults.
const STRICT_RATE_LIMIT_OVERRIDES: Record<string, number> = {
  "/api/auth/webauthn/register": 12,
};
const RATE_LIMIT_MAP_MAX_SIZE = 10_000;

// Voice ingest (Siri Shortcut → POST). Auth is a per-user VoiceToken verified
// in the route handler (SHA-256 hashed lookup), NOT a session. The Shortcut's
// POST carries no Origin / Sec-Fetch-Site header, so this prefix must be
// exempt from BOTH the CSRF check and the session gate — otherwise every
// voice POST dies with 403/401. It is a DEDICATED prefix so the
// exemption can never grow to cover session-guarded routes like /api/items.
const VOICE_INGEST_PREFIX = "/api/ingest/";

// The machine-to-machine half of the price API. Auth is the N8N_API_KEY Bearer
// checked in each route handler. Those calls carry no session, no Origin and no
// Sec-Fetch-Site, so they must skip both the session gate and the CSRF check or
// they die with 401/403 before reaching the handler.
//
// An explicit allow-list, NOT the /api/prices prefix: the rest of the price API
// is session-guarded and must never inherit this exemption.
//
// The DAILY RUN is no longer one of these. It used to be a scheduled task
// outside the container firing `POST /api/prices/check`, which meant a fresh
// install tracked prices that nobody ever checked; since src/lib/scheduler.ts
// the application keeps its own clock and calls runPriceCheck in process, with
// no HTTP hop and no API key. `check` stays as the manual and debugging way in.
// `queue`, `ingest` and `fetch-jobs` belong to the external reader and answer
// 410 unless PRICE_FETCH_MODE=assisted.
const API_KEY_ROUTES = [
  "/api/prices/check",
  "/api/prices/queue",
  "/api/prices/ingest",
  "/api/prices/fetch-jobs",
];

// The blanket CSRF exemption of the /api/auth prefix is justified by NextAuth's
// own CSRF token, and that token covers NextAuth's routes — not the WebAuthn
// ceremony endpoints this app added under the same prefix. They are excluded
// again here. It is not exploitable today (the session cookie is SameSite=Lax
// so it never rides a cross-site POST, and the ceremony is origin-bound), but
// registration is the one endpoint whose success is irreversible and the
// defence should not rest entirely on a cookie attribute set in another file.
// The app's own calls are same-origin `fetch`, which sends
// `Sec-Fetch-Site: same-origin`, so nothing legitimate is affected.
const CSRF_CHECKED_AUTH_PREFIX = "/api/auth/webauthn/";

const STRICT_RATE_LIMIT_ROUTES = [
  "/api/auth/signin",
  "/api/auth/callback",
  "/login",
  "/api/auth/webauthn/options",
  // Voice ingest: public + token-authed. A Shortcut fires at human cadence;
  // 5/min per IP per path is generous for humans, hostile to brute force.
  "/api/ingest",
  // First run. Both are public and both accept a secret typed by a human, so
  // they are the two endpoints on this instance where guessing is worth the
  // attempt. The registration prefix covers BOTH steps of the ceremony, so
  // hammering the cheaper half does not buy a bigger budget.
  "/api/setup",
  "/api/auth/webauthn/register",
  // Everybody after the first person. Public and typed by a human, same as
  // /api/setup — and five a minute is plenty, because one honest redemption is
  // one request. The passkey route to the same redemption is the registration
  // prefix above, which is already covered.
  "/api/invitations/redeem",
];
// `/api/invitations/redeem` and NOT `/api/invitations`: the matching is by
// prefix, so the shorter string would make the CREATION endpoint public too and
// hand anybody the power to mint invitations to this instance.
const PUBLIC_API_ROUTES = [
  "/api/health",
  "/api/auth",
  "/api/setup",
  "/api/invitations/redeem",
  VOICE_INGEST_PREFIX,
  ...API_KEY_ROUTES,
];
const PUBLIC_PAGE_ROUTES = ["/login", "/setup"];
// Public pages whose path carries a value. Matched by prefix, which the exact
// list above deliberately is not: `/login` must not also mean `/loginXYZ`. The
// invited person has no session by definition, so without this the proxy sends
// them to /login and the invitation cannot be used at all.
const PUBLIC_PAGE_PREFIXES = ["/invite/"];
const PUBLIC_ASSET_PATHS = ["/manifest.json", "/sw.js", "/icons", "/favicon.ico", "/favicon.svg"];

const rateLimitMap = new Map<string, { count: number; resetTime: number }>();

function evictExpired(): void {
  const now = Date.now();
  for (const [key, record] of rateLimitMap.entries()) {
    if (now > record.resetTime) rateLimitMap.delete(key);
  }
}

function checkRateLimit(key: string, max: number): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);
  if (!record || now > record.resetTime) {
    if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX_SIZE) evictExpired();
    if (rateLimitMap.size >= RATE_LIMIT_MAP_MAX_SIZE) return false;
    rateLimitMap.set(key, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }
  if (record.count >= max) return false;
  record.count++;
  return true;
}

if (typeof setInterval !== "undefined") {
  // Unref'd for the same reason the scheduler's timer is: this module is
  // imported by the test runner and evaluated during `next build`, and a live
  // event-loop handle in either of those is a process that will not exit on its
  // own. What keeps the server up is the server.
  //
  // No `globalThis` guard here, deliberately: in a production build this module
  // is evaluated once, so the stacking that guard would prevent is a `next dev`
  // annoyance over a Map walk, not a correctness problem like two price runs.
  setInterval(evictExpired, 60 * 1000).unref?.();
}

/**
 * Does `pathname` fall under the public API route `route`?
 *
 * On a SEGMENT boundary, not on a raw `startsWith`. A bare prefix test makes
 * `/api/invitations/redeemXYZ` public because `/api/invitations/redeem` is —
 * and Next routes that to `/api/invitations/[id]`, whose DELETE revokes an
 * invitation. No real id starts with "redeem", so nothing was reachable, but
 * "unreachable by luck" is not the same as closed, and the same slip on
 * `/api/setup` or `/api/auth` would be worse. PUBLIC_ASSET_PATHS already
 * matched this way; this brings the API list in line.
 *
 * Entries that already end in `/` are prefixes on purpose (the voice ingest
 * namespace) and keep behaving as such.
 */
function matchesApiRoute(pathname: string, route: string): boolean {
  if (route.endsWith("/")) return pathname.startsWith(route);
  return pathname === route || pathname.startsWith(route + "/");
}

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PAGE_ROUTES.includes(pathname)) return true;
  if (PUBLIC_PAGE_PREFIXES.some((p) => pathname.startsWith(p))) return true;
  if (PUBLIC_API_ROUTES.some((p) => matchesApiRoute(pathname, p))) return true;
  if (PUBLIC_ASSET_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) return true;
  return false;
}

function buildCsp(): string {
  // `script-src 'unsafe-inline'` is the weakest line in this policy and it is
  // here because nothing has been built to replace it — not because a nonce is
  // impossible. It used to say the pages were statically prerendered and so had
  // no request to take a nonce from; since the i18n work that is no longer true,
  // and `pnpm build` reports every route as ƒ (Dynamic).
  //
  // What still blocks a nonce policy is work, and it is more than one line:
  // every inline script in the document has to carry the same per-request value
  // — Next's own bootstrap and hydration payload, which means passing the nonce
  // through the framework, and this app's pre-paint theme bootstrap in
  // src/app/layout.tsx — and 'strict-dynamic' has to be verified against the
  // service worker and the chunk loader. Get one of those wrong and the page
  // does not hydrate at all, which is a blank screen rather than a degraded one.
  // That is its own change with its own test, not a line in a release whose job
  // is that a stranger can install this.
  //
  // So: same-origin plus inline. Every Next chunk is same-origin under
  // /_next/static ('self') and the bootstraps are inline ('unsafe-inline').
  // `next dev` also needs eval.
  const scriptSrc =
    process.env.NODE_ENV === "production"
      ? `script-src 'self' 'unsafe-inline'`
      : `script-src 'self' 'unsafe-inline' 'unsafe-eval'`;
  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    // https: is needed for the price-tracking cards: product thumbnails come
    // from whatever shop the URL points at, so there is no host list to
    // allow. Images only — scripts/styles/connect stay locked to 'self'.
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self'",
    "manifest-src 'self'",
    "worker-src 'self' blob:",
    // Nobody legitimately iframes a shopping list.
    "frame-ancestors 'self'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

function withSecurityHeaders(res: NextResponse, csp: string): NextResponse {
  res.headers.set("Content-Security-Policy", csp);
  return withHsts(res);
}

// HSTS is separate because it belongs on EVERY response, not only the two that
// carry a CSP. next.config.ts used to set it on all of them — its headers() run
// before the middleware route and are applied whether or not the middleware
// short-circuits — including the 401, the 403, the 429 and the redirect to
// /login, and that redirect is the most likely first response an
// unauthenticated visitor ever sees, which is exactly when the pin should be
// established. Over plain HTTP it is omitted: pinning the browser to an https://
// this instance does not serve would lock the household out.
function withHsts(res: NextResponse): NextResponse {
  const hsts = hstsHeader();
  if (hsts) res.headers.set("Strict-Transport-Security", hsts);
  return res;
}

// The origin the CSRF check compares against is configured, not reconstructed
// from forwarded headers: an attacker controls those, and a check whose
// expected value the attacker sets is not a check.
function expectedPublicOrigin(): string {
  return appOrigin().origin;
}

function isCsrfSafe(request: NextRequest): boolean {
  const method = request.method;
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return true;

  // Sec-Fetch-Site is a forbidden header — page JS can't set it.
  const sfSite = request.headers.get("sec-fetch-site");
  if (sfSite) {
    if (sfSite === "same-origin" || sfSite === "none") return true;
    return false;
  }

  const origin = request.headers.get("origin");
  if (origin) return origin === expectedPublicOrigin();
  const referer = request.headers.get("referer");
  if (referer) {
    try {
      return new URL(referer).host === new URL(expectedPublicOrigin()).host;
    } catch {
      return false;
    }
  }
  return false;
}

// Strict requests count in their OWN key space, separate from ordinary ones.
//
// They used to share a counter while being judged against different limits — 5
// for a mutating request, 100 for the rest — so every harmless read spent an
// allowance sized for five guesses. Six GETs of
// /api/auth/webauthn/register left the next POST at 429, which is a request
// refused for something it did not do, and it lands on the one step of the
// registration ceremony that comes after the authenticator prompt. Measured on
// `next start` with TRUSTED_PROXY=x-real-ip, the deployed setting.
//
// The strict key is the MATCHED PREFIX, not the pathname: padded suffixes under
// the same route must not mint a bucket each, which is the same reasoning
// checkRouteCeiling already follows one level down. It also parts the login
// ceremony from registration, which have different shapes and different costs.
function rateLimitKey(ip: string, pathname: string, strictRoute: string | undefined): string {
  if (strictRoute !== undefined) return `strict:${ip}:${strictRoute}`;
  // Non-mutating traffic across the WebAuthn ceremony still shares one bucket,
  // so padding the path cannot mint buckets there either.
  if (pathname.startsWith("/api/auth/webauthn/")) return `webauthn:${ip}`;
  return `${ip}:${pathname}`;
}

let booted = false;

// Validated on the first request, never at module scope: middleware module
// scope runs on cold start before any request, and tooling (next build, the
// test runner) imports this module with neither APP_ORIGIN nor a database.
function bootOnce(): void {
  if (booted) return;
  // Fails with the name of the variable that is wrong, on the first request
  // rather than deep inside a handler three screens later.
  //
  // The flag is set AFTER the check, not before: setting it first would mean a
  // misconfigured instance answers 500 exactly once and then serves every
  // later request with the guard satisfied and the configuration still wrong.
  assertEnv();
  booted = true;

  // Printed once per boot while the instance is unclaimed, so `docker compose
  // logs` is what proves you are the one installing it.
  //
  // AFTER `booted = true`, and deliberately so: `booted` means "validated", and
  // what has to hold for the instance to count as up goes before it. This does
  // not — it opens a database connection, and an instance whose database is not
  // up yet is still a correctly configured instance. It is best effort: a
  // failure here must not turn every request into a 500. It is reported rather
  // than swallowed — an instance that cannot print its token is one nobody can
  // install, and silence there is the difference between a five-second fix and
  // an afternoon.
  void isClaimed()
    .then((claimed) => {
      if (!claimed) console.info(`[setup] installation token: ${setupToken()}`);
    })
    .catch((error) => {
      console.warn("[setup] could not print the installation token:", error);
    });

  // The daily price run, on the same terms and for the same reason: after
  // `booted = true` because an instance with no scheduler is still a correctly
  // configured instance, and a schedule must never be able to turn every
  // request into a 500. It is idempotent and guarded on `globalThis`, so the
  // first request wins however many times this module gets instantiated.
  //
  // Here and not at module scope: module scope of the proxy runs during
  // `next build` too, and a build has no business arming a timer or reaching
  // for a database.
  startPriceScheduler();
}

export async function proxy(request: NextRequest) {
  bootOnce();

  const { pathname } = request.nextUrl;

  // Skip auth() DB roundtrip for public asset paths.
  if (PUBLIC_ASSET_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"))) {
    return withHsts(NextResponse.next());
  }

  // CSRF-class defense for state-changing requests. NextAuth's CSRF token
  // covers its own routes under /api/auth/* — but not the WebAuthn endpoints
  // this app added under that prefix, which are checked again (see
  // CSRF_CHECKED_AUTH_PREFIX). The voice ingest prefix authenticates via a
  // Bearer VoiceToken that a cross-site form cannot forge, so it is exempt too.
  if (
    (!pathname.startsWith("/api/auth") || pathname.startsWith(CSRF_CHECKED_AUTH_PREFIX)) &&
    !pathname.startsWith(VOICE_INGEST_PREFIX) &&
    !API_KEY_ROUTES.includes(pathname) &&
    !isCsrfSafe(request)
  ) {
    return withHsts(new NextResponse("Forbidden", { status: 403 }));
  }

  // Only the header TRUSTED_PROXY names is believed. Anything else is a value
  // the caller chooses, and a bucket keyed on it is a bucket per attempt.
  const ip = clientIPFromHeaders(request.headers, { trustedProxy: trustedProxy() });
  const isMutating =
    request.method === "POST" ||
    request.method === "PUT" ||
    request.method === "PATCH" ||
    request.method === "DELETE";
  // The matched prefix, not the raw pathname: STRICT_RATE_LIMIT_ROUTES matches
  // by prefix, so keying the ceiling on the pathname would let padded suffixes
  // under the same route mint a fresh bucket each — the very trick the ceiling
  // exists to deny.
  const strictRoute = isMutating
    ? STRICT_RATE_LIMIT_ROUTES.find((p) => pathname.startsWith(p))
    : undefined;
  const isStrict = strictRoute !== undefined;
  const limit = isStrict
    ? (STRICT_RATE_LIMIT_OVERRIDES[strictRoute] ?? STRICT_RATE_LIMIT_MAX)
    : RATE_LIMIT_MAX_REQUESTS;

  // With no trustworthy address there is nothing to key a bucket on, so the IP
  // limiter is skipped rather than keyed on a constant: a single shared bucket
  // would rate-limit every visitor against every other one. The per-account
  // throttle defends the login in that configuration; see src/lib/login-throttle.ts.
  if (ip) {
    if (!checkRateLimit(rateLimitKey(ip, pathname, strictRoute), limit)) {
      return withHsts(new NextResponse("Too Many Requests", { status: 429 }));
    }
  } else if (isStrict && !checkRouteCeiling(strictRoute)) {
    // No trustworthy address (TRUSTED_PROXY=none): a per-IP bucket keyed on a
    // value the caller picks is worse than none, but leaving the strict routes
    // uncapped means unmetered guessing at /api/ingest, whose bearer token
    // belongs to no account and so is invisible to the per-account throttle.
    return withHsts(new NextResponse("Too Many Requests", { status: 429 }));
  }

  const csp = buildCsp();

  if (isPublicPath(pathname)) {
    return withSecurityHeaders(NextResponse.next(), csp);
  }

  const session = await auth();
  if (!session) {
    if (pathname.startsWith("/api/")) {
      const res = new NextResponse("Unauthorized", { status: 401 });
      res.headers.set("Cache-Control", "no-store, private");
      return withHsts(res);
    }
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return withHsts(NextResponse.redirect(loginUrl));
  }

  return withSecurityHeaders(NextResponse.next(), csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons|sw\\.js|manifest\\.json|favicon\\.ico|favicon\\.svg).*)"],
};
