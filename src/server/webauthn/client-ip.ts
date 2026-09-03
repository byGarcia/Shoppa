import "server-only";

import type { TrustedProxy } from "@/lib/env";

export interface ClientIPOptions {
  /**
   * Which upstream, if any, is allowed to tell us the client address.
   * "none" means nothing is believed: NextRequest does not expose the socket
   * address in Next 16, so there is no trustworthy fallback and pretending
   * otherwise would key the rate limiter on a value the caller picks.
   */
  trustedProxy?: TrustedProxy;
}

export function clientIPFromHeaders(
  headers: Headers,
  options: ClientIPOptions = {},
): string | null {
  // Every branch trims and collapses an empty result to null. A header of " "
  // is truthy: left raw it would become one shared constant bucket for every
  // caller — the exact failure keying on a trusted header exists to prevent —
  // and it would be written into security_logs.ipAddress as "" rather than null.
  switch (options.trustedProxy ?? "none") {
    case "cloudflare":
      return headers.get("cf-connecting-ip")?.trim() || null;
    case "x-real-ip":
      return headers.get("x-real-ip")?.trim() || null;
    case "xff":
      return headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null;
    case "none":
    default:
      return null;
  }
}
