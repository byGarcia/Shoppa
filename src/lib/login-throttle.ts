/**
 * Failed-login throttle, keyed on the account rather than on the caller's IP.
 *
 * The IP buckets in src/proxy.ts are off whenever TRUSTED_PROXY=none, because
 * Next 16 gives middleware no socket address and a forged X-Real-IP would just
 * mint a fresh bucket per attempt. An attacker cannot forge which account they
 * are attacking, so this is the limit that actually holds.
 *
 * It is a waiting window, not a lock: a permanent lock would hand anybody a way
 * to shut a household out of its own list.
 *
 * State is in memory on purpose. The rate limiter in src/proxy.ts already works
 * that way, a single container has nowhere else to keep it, and a restart
 * clearing the counters is a worse outcome for an attacker than for a
 * household: restarting the container is not something an attacker can do.
 */
const MAX_ENTRIES = 10_000;
const MINUTE_MS = 60_000;

export const MAX_FAILURES = 5;
export const WINDOW_MS = 15 * 60 * 1000;
export const INSTANCE_CEILING_PER_MIN = 60;

/**
 * Absolute cap, per strict route and per minute, on requests that arrive with
 * no trustworthy client address. Shared by everyone: a flood costs the
 * household a minute of its own voice ingest, and in exchange the guessing is
 * bounded no matter how many addresses the attacker forges.
 */
export const ROUTE_CEILING_PER_MIN = 30;

type Entry = { failures: number; firstFailureAt: number };
type RouteEntry = { count: number; windowStart: number };

const perAccount = new Map<string, Entry>();
const perRoute = new Map<string, RouteEntry>();
const knownGood = new Set<string>();
let instanceWindowStart = 0;
let instanceFailures = 0;

/**
 * The key is normalised HERE rather than trusted from the caller. If the login
 * path passed the raw identifier, `Ana@x.com`, `ana@x.com` and `ana@x.com `
 * would be three separate counters — five guesses each, unlimited spellings,
 * and the throttle silently gone with every test still green. An invariant of
 * the module cannot be forgotten at a call site; an instruction in a handover
 * can.
 */
function normalize(accountKey: string): string {
  return accountKey.trim().toLowerCase();
}

function evictExpired(now: number): void {
  for (const [key, entry] of perAccount.entries()) {
    if (now - entry.firstFailureAt > WINDOW_MS) perAccount.delete(key);
  }
}

function evictExpiredRoutes(now: number): void {
  for (const [key, entry] of perRoute.entries()) {
    if (now - entry.windowStart > MINUTE_MS) perRoute.delete(key);
  }
}

export function isThrottled(rawKey: string): boolean {
  const accountKey = normalize(rawKey);
  const now = Date.now();
  // The instance ceiling bounds how much scrypt an attacker can make this
  // container burn by rotating through invented account names. It must NOT
  // apply to an account that has signed in successfully here: otherwise one
  // request per second holds the ceiling engaged forever and the household is
  // locked out of its own list indefinitely — a far worse outcome than the
  // spraying it defends against, and the same mistake as a permanent
  // per-account lock, one level up. Rotation only ever uses keys nobody has
  // succeeded with, so the exemption is not an escape.
  if (
    !knownGood.has(accountKey) &&
    now - instanceWindowStart <= MINUTE_MS &&
    instanceFailures >= INSTANCE_CEILING_PER_MIN
  ) {
    return true;
  }
  const entry = perAccount.get(accountKey);
  if (!entry) return false;
  if (now - entry.firstFailureAt > WINDOW_MS) {
    perAccount.delete(accountKey);
    return false;
  }
  return entry.failures >= MAX_FAILURES;
}

export function recordFailure(rawKey: string): void {
  const accountKey = normalize(rawKey);
  const now = Date.now();

  if (now - instanceWindowStart > MINUTE_MS) {
    instanceWindowStart = now;
    instanceFailures = 0;
  }
  instanceFailures += 1;

  const entry = perAccount.get(accountKey);
  if (!entry || now - entry.firstFailureAt > WINDOW_MS) {
    if (perAccount.size >= MAX_ENTRIES) {
      evictExpired(now);
      // Fail closed, the way checkRateLimit in src/proxy.ts already does. When
      // every entry is live the sweep frees nothing, and inserting anyway lets
      // an attacker with a large address space grow this map without bound —
      // which counting invented account names makes easy on purpose.
      if (perAccount.size >= MAX_ENTRIES) return;
    }
    perAccount.set(accountKey, { failures: 1, firstFailureAt: now });
    return;
  }
  entry.failures += 1;
}

export function recordSuccess(rawKey: string): void {
  const accountKey = normalize(rawKey);
  perAccount.delete(accountKey);
  // Remembering who has genuinely signed in is what keeps the instance ceiling
  // from becoming a global lockout. It is memory-only, so after a restart the
  // household's first sign-in is subject to the ceiling again; that window is
  // the price of not persisting a list of who lives here.
  if (knownGood.size < MAX_ENTRIES) knownGood.add(accountKey);
}

/**
 * Route-level instance ceiling. Returns false once `routeKey` has been asked
 * for more than ROUTE_CEILING_PER_MIN times inside the current minute.
 *
 * Used by src/proxy.ts in place of the per-IP bucket when clientIPFromHeaders
 * returns null, so a strict route keeps an absolute cap with TRUSTED_PROXY=none
 * — including /api/ingest, whose bearer token belongs to no account and is
 * therefore invisible to the per-account throttle above.
 */
export function checkRouteCeiling(routeKey: string): boolean {
  const now = Date.now();
  const entry = perRoute.get(routeKey);
  if (!entry || now - entry.windowStart > MINUTE_MS) {
    if (perRoute.size >= MAX_ENTRIES) {
      evictExpiredRoutes(now);
      // Fail closed as well. src/proxy.ts keys this on the matched prefix, so
      // the key space is exactly STRICT_RATE_LIMIT_ROUTES — eight entries today
      // — and the guard is unreachable; it is here so that it stays a cap if
      // that list ever grows past MAX_ENTRIES.
      if (perRoute.size >= MAX_ENTRIES) return false;
    }
    perRoute.set(routeKey, { count: 1, windowStart: now });
    return true;
  }
  if (entry.count >= ROUTE_CEILING_PER_MIN) return false;
  entry.count += 1;
  return true;
}

/** Test seam. Never called by application code. */
export function resetThrottleForTests(): void {
  perAccount.clear();
  perRoute.clear();
  knownGood.clear();
  instanceWindowStart = 0;
  instanceFailures = 0;
}
