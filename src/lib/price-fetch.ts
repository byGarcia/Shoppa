/**
 * The dirty half of price reading: network. Kept apart from price-extract.ts so
 * the parsing can be unit-tested without internet.
 *
 * Best-effort by design: shops that block datacenter IPs produce
 * a typed failure, never a fabricated price.
 *
 * Amazon reality (measured 2026-07-23 against live amazon.es): a cold, cookie-
 * less request is served a ~4 KB "Seguir comprando" / validateCaptcha wall from
 * almost any IP; a request that carries a homepage-established session gets the
 * real 3 MB product page. So for Amazon we prime a session first, send full
 * browser headers, and retry once. It improves the odds at the daily-run rate;
 * it does NOT guarantee Amazon, which the "type it by hand" fallback covers.
 *
 * SSRF: the URL is attacker-controlled in the weak sense — it comes from a
 * household member through a session or a VoiceToken, and the response is
 * partially echoed back (title, image, price) by /api/prices/preview. Whatever
 * network this instance sits in has other things in it, so an unguarded fetch
 * turns the add-product form into an internal port scanner and a stored URL
 * into a daily one. Hence `assertPublicTarget`, applied to the initial URL AND
 * to every redirect hop.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { awaitFetch, enqueueFetch } from "./fetch-jobs";
import { apiText } from "@/lib/api-messages";
import { priceFetchMode } from "@/lib/env";

const TIMEOUT_MS = 10_000;
/** A product page over this is either an attack or a page we cannot use anyway. */
const MAX_BYTES = 4_000_000;
/** Shops chain a couple of redirects (locale, canonical). More is not a shop. */
const MAX_REDIRECTS = 4;
/**
 * How long to wait for an assisted-mode fetcher when this host hits a bot wall.
 *
 * Budget (measured 2026-07-24): fetcher poll <=3 s + download. A plain `curl`
 * download is ~1 s and a headless-browser one ~4 s warm, but a cold browser run
 * that has to walk an interstitial and re-request the page costs ~15 s. 30 s
 * leaves room for that without letting a hung fetcher hang the request forever.
 */
const HOME_FETCH_WAIT_MS = 30_000;
/** A page below this that also carries a bot-wall marker is a wall, not a product. */
const BLOCK_PAGE_MAX_BYTES = 100_000;
/** Reuse a primed session across products in a run (and a bit beyond). */
const SESSION_TTL_MS = 30 * 60 * 1000;

/** Full Chrome header set. The sparse set is itself a bot tell on Amazon. */
const RICH_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
  "sec-ch-ua": '"Chromium";v="131", "Not_A Brand";v="24", "Google Chrome";v="131"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "cache-control": "max-age=0",
};

/**
 * Markers that mean "we served you a bot wall", not a product page — but only
 * on a SMALL page. A real Amazon product page is megabytes and can legitimately
 * contain the word "captcha" or a "Seguir comprando" button, so the size guard
 * (below) is what prevents false-positives. The wall itself is ~4 KB.
 */
const BLOCK_MARKERS = [
  "validatecaptcha",
  "automated access",
  "api-services-support",
  "introduce los caracteres",
  "enter the characters you see",
  "robot check",
  "captcha-delivery.com",
  "px-captcha",
  "cf-browser-verification",
];

export type FetchFailureKind = "blocked" | "http" | "network";

export type FetchProductResult =
  | { ok: true; html: string; finalUrl: string }
  | { ok: false; kind: FetchFailureKind; message: string };

export type FetchOptions = {
  /**
   * Return false when the downloaded HTML is not a usable product page — in
   * practice: it contains no price. A shop that fobs off a datacenter IP does
   * not always send a recognisable bot wall; sometimes it just serves a page
   * with everything except the price. Keying the home fallback on "did we
   * actually get a price" instead of on "did it look like a wall" is what makes
   * it robust, because it stops depending on marker strings we have to guess.
   */
  isUsable?: (html: string) => boolean;
};

// ============================================================================
// SSRF GUARD
// ============================================================================

/** Hostnames that never belong to a shop and often resolve to something juicy. */
const BLOCKED_HOST_SUFFIXES = [".localhost", ".internal", ".local", ".home.arpa"];
const BLOCKED_HOSTS = ["localhost", "metadata.google.internal", "instance-data"];

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.includes(host)) return true;
  return BLOCKED_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/**
 * True for any address that is not routable public internet: loopback, RFC1918,
 * link-local (incl. the 169.254.169.254 cloud metadata endpoint), CGNAT,
 * unique-local, multicast and reserved space.
 */
export function isBlockedAddress(address: string): boolean {
  const version = isIP(address);
  if (version === 4) return isBlockedIPv4(address);
  if (version === 6) return isBlockedIPv6(address);
  return true; // Unparseable: refuse rather than guess.
}

function isBlockedIPv4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts as [number, number, number, number];

  if (a === 0) return true; // 0.0.0.0/8
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 192 && b === 0) return true; // 192.0.0.0/24 IETF protocol assignments
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a >= 224) return true; // multicast + reserved
  return false;
}

function isBlockedIPv6(address: string): boolean {
  const host = address.toLowerCase().split("%")[0] ?? "";

  // IPv4-mapped/compatible (::ffff:127.0.0.1) must be judged as the IPv4 it is.
  const embedded = host.match(/^::(?:ffff:)?(\d+\.\d+\.\d+\.\d+)$/);
  if (embedded?.[1]) return isBlockedIPv4(embedded[1]);

  if (host === "::" || host === "::1") return true;
  if (host.startsWith("fe8") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) {
    return true; // fe80::/10 link-local
  }
  if (host.startsWith("fc") || host.startsWith("fd")) return true; // fc00::/7 unique-local
  if (host.startsWith("ff")) return true; // multicast
  return false;
}

/**
 * Resolve the target and refuse anything pointing inside the machine or its
 * network. Returns a human reason when blocked, null when allowed.
 *
 * Note this resolves and then fetches by hostname, so a DNS rebind between the
 * two calls is theoretically possible. Closing that needs pinning the socket to
 * the checked IP; against an already-authenticated household member it is not
 * worth the complexity, and everything cheap is covered here.
 */
async function assertPublicTarget(target: URL): Promise<string | null> {
  if (target.protocol !== "http:" && target.protocol !== "https:") {
    return apiText("fetch.onlyHttp");
  }

  const hostname = target.hostname.replace(/^\[|\]$/g, "");
  if (isBlockedHostname(hostname)) return apiText("fetch.notPublic");

  if (isIP(hostname)) {
    return isBlockedAddress(hostname) ? apiText("fetch.notPublic") : null;
  }

  let addresses: Array<{ address: string }>;
  try {
    addresses = await lookup(hostname, { all: true });
  } catch {
    return apiText("fetch.dnsFailed");
  }
  if (addresses.length === 0) return apiText("fetch.dnsFailed");
  // Every answer must be public: one private A record is enough to abuse.
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    return apiText("fetch.notPublic");
  }
  return null;
}

/**
 * Public-facing guard for the add flow: refuse a URL that resolves to anything
 * private BEFORE it is stored.
 *
 * It matters most in `assisted` mode, where the daily fetch runs from a machine
 * INSIDE the operator's own network: a stored private address would be a daily
 * request against whatever answers on it — a dashboard, a hypervisor, a router
 * — and not merely against this server. Returns a human reason when blocked,
 * null when allowed.
 */
export async function assertPublicUrl(rawUrl: string): Promise<string | null> {
  let target: URL;
  try {
    target = new URL(rawUrl);
  } catch {
    return apiText("fetch.invalidUrl");
  }
  return assertPublicTarget(target);
}

// ============================================================================
// SESSION PRIMING
// ============================================================================

/** host → accumulated cookie jar. Shops that wall cookieless requests. */
const sessionJars = new Map<string, { cookie: string; at: number }>();

/** Bare host (no www) helper for jar keys and priming decisions. */
function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/^www\./, "");
}

/**
 * Only Amazon needs this today; a plain fetch is enough everywhere else.
 * `amzn.eu` / `amzn.to` are the short links the phone's share sheet produces —
 * they redirect to a normal product page, so they need the same treatment.
 */
function hostNeedsSession(hostname: string): boolean {
  const host = bareHost(hostname);
  return (
    host.startsWith("amazon.") ||
    host.endsWith(".amazon.com") ||
    host.includes(".amazon.") ||
    host.startsWith("amzn.")
  );
}

/** Fold a response's Set-Cookie headers into an existing jar string. */
function mergeCookies(existing: string, res: Response): string {
  const set = res.headers.getSetCookie?.() ?? [];
  const jar = new Map<string, string>();
  for (const pair of existing.split("; ").filter(Boolean)) {
    const i = pair.indexOf("=");
    if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  for (const cookie of set) {
    const first = cookie.split(";")[0] ?? "";
    const i = first.indexOf("=");
    if (i > 0) jar.set(first.slice(0, i).trim(), first.slice(i + 1).trim());
  }
  return [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
}

/**
 * Establish a session by visiting the shop's homepage, so the product request
 * arrives with cookies like a real second navigation. Best-effort: a failure
 * here just means the product fetch tries cookieless. `force` re-primes after a
 * wall so the retry gets a fresh session.
 */
async function primeSession(origin: URL, force = false): Promise<void> {
  const key = origin.hostname;
  const cached = sessionJars.get(key);
  if (!force && cached && Date.now() - cached.at < SESSION_TTL_MS) return;

  if (await assertPublicTarget(origin)) return;
  try {
    const res = await fetch(origin, {
      headers: { ...RICH_HEADERS, "sec-fetch-site": "none" },
      redirect: "manual",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
    void res.body?.cancel().catch(() => undefined); // We only want the cookies.
    sessionJars.set(key, { cookie: mergeCookies(cached?.cookie ?? "", res), at: Date.now() });
  } catch {
    // Priming is best-effort; leave whatever jar we had.
  }
}

// ============================================================================
// FETCH
// ============================================================================

/** Read the body but stop at MAX_BYTES instead of buffering whatever arrives. */
async function readCapped(response: Response): Promise<string> {
  const body = response.body;
  if (!body) return await response.text();

  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8");
  const parts: string[] = [];
  let total = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      parts.push(decoder.decode(value, { stream: true }));
      if (total >= MAX_BYTES) break;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  parts.push(decoder.decode());
  return parts.join("");
}

/** A small page carrying a bot-wall marker. Big real pages are never blocked. */
function looksBlocked(html: string): boolean {
  if (html.length >= BLOCK_PAGE_MAX_BYTES) return false;
  const head = html.slice(0, 20_000).toLowerCase();
  return BLOCK_MARKERS.some((marker) => head.includes(marker));
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** One full fetch attempt (initial URL + guarded redirect hops). */
async function attemptFetch(startUrl: URL, primed: boolean): Promise<FetchProductResult> {
  let current = startUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const blocked = await assertPublicTarget(current);
    if (blocked) return { ok: false, kind: "blocked", message: blocked };

    const jar = sessionJars.get(current.hostname)?.cookie;
    const headers: Record<string, string> = { ...RICH_HEADERS };
    if (primed && jar) {
      // A primed request looks like an in-site navigation; a cold one does not.
      headers["sec-fetch-site"] = "same-origin";
      headers.Referer = `${current.protocol}//${current.host}/`;
    } else {
      headers["sec-fetch-site"] = "none";
    }
    if (jar) headers.Cookie = jar;

    let response: Response;
    try {
      response = await fetch(current, {
        headers,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : await apiText("fetch.networkError");
      const timedOut =
        error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
      return {
        ok: false,
        kind: "network",
        message: timedOut ? await apiText("fetch.timeout") : message,
      };
    }

    // Keep any cookies the shop hands out mid-flow.
    sessionJars.set(current.hostname, {
      cookie: mergeCookies(sessionJars.get(current.hostname)?.cookie ?? "", response),
      at: Date.now(),
    });

    if (REDIRECT_STATUSES.has(response.status)) {
      void response.body?.cancel().catch(() => undefined);
      const location = response.headers.get("location");
      if (!location) return { ok: false, kind: "http", message: await apiText("fetch.redirectNoTarget") };
      try {
        current = new URL(location, current);
      } catch {
        return { ok: false, kind: "http", message: await apiText("fetch.redirectInvalid") };
      }
      continue;
    }

    if (response.status === 403 || response.status === 429 || response.status === 503) {
      void response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        kind: "blocked",
        message: await apiText("fetch.blocked", { status: String(response.status) }),
      };
    }
    if (!response.ok) {
      void response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        kind: "http",
        message: await apiText("fetch.httpStatus", { status: String(response.status) }),
      };
    }

    const html = await readCapped(response);
    if (looksBlocked(html)) {
      return { ok: false, kind: "blocked", message: await apiText("fetch.botWall") };
    }
    return { ok: true, html, finalUrl: current.toString() };
  }

  return { ok: false, kind: "http", message: await apiText("fetch.tooManyRedirects") };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Ask an assisted-mode fetcher to download it. Returns null if that did not
 * work out.
 *
 * In `local` mode there is no fetcher: nobody is polling
 * /api/prices/fetch-jobs, so the job would sit in the queue until
 * HOME_FETCH_WAIT_MS gave up. Thirty seconds per product is how a fresh install
 * stops looking slow and starts looking broken — the first price run of a list
 * with ten tracked products would spend five minutes waiting for something that
 * does not exist. So the queue is not even touched unless the operator asked
 * for it.
 */
async function fetchAtHome(url: string, opts: FetchOptions): Promise<FetchProductResult | null> {
  if (priceFetchMode() === "local") return null;
  const remote = await awaitFetch(enqueueFetch(url), HOME_FETCH_WAIT_MS);
  if (!("html" in remote)) return null;
  if (opts.isUsable && !opts.isUsable(remote.html)) return null;
  return { ok: true, html: remote.html, finalUrl: url };
}

/** Try from this host: session priming for walled shops, plus one retry. */
async function fetchHere(start: URL, needsSession: boolean): Promise<FetchProductResult> {
  const origin = new URL(`${start.protocol}//${start.host}/`);

  if (needsSession) await primeSession(origin);
  const result = await attemptFetch(start, needsSession);
  if (result.ok || result.kind !== "blocked" || !needsSession) return result;

  // A single retry, only for a wall on a session shop: re-prime and pace.
  await sleep(1_500);
  await primeSession(origin, true);
  return attemptFetch(start, true);
}

/**
 * Download a product page. Returns a typed failure instead of throwing, because
 * one unreachable shop must not abort the whole daily run.
 *
 * Order matters. For shops known to wall datacenter IPs (Amazon) the assisted
 * fetcher goes FIRST: spending attempts from the worst-placed address wins
 * nothing and adds load to a host whose blocking is adaptive — hammer it and it
 * starts refusing the good address too (learned the hard way on 2026-07-24,
 * when a burst of tests got the residential line throttled as well). Everywhere
 * else this host tries first, because it is instant, and the fetcher is the
 * fallback.
 *
 * Two things count as "fobbed off": an outright wall, or a page with no price
 * in it. Keying on the second is what stops the fallback from depending on
 * bot-wall marker strings the shop can change at will.
 *
 * In `local` mode the assisted half is a no-op (see fetchAtHome), so all of
 * this collapses to "try from here", which is what an instance with no external
 * fetcher should do.
 */
export async function fetchProductHtml(
  url: string,
  opts: FetchOptions = {},
): Promise<FetchProductResult> {
  let start: URL;
  try {
    start = new URL(url);
  } catch {
    return { ok: false, kind: "blocked", message: await apiText("fetch.invalidUrl") };
  }

  const needsSession = hostNeedsSession(start.hostname);

  if (needsSession) {
    const home = await fetchAtHome(start.toString(), opts);
    if (home) return home;
  }

  const local = await fetchHere(start, needsSession);
  const uselessPage = local.ok && opts.isUsable !== undefined && !opts.isUsable(local.html);
  if (local.ok && !uselessPage) return local;

  if (!needsSession) {
    const home = await fetchAtHome(start.toString(), opts);
    if (home) return home;
  }

  // Nobody could read it. Keep the real page if we have one: the caller then
  // reports "no price found", which is the honest answer.
  return local;
}
