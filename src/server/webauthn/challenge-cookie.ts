import "server-only";
import type { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

import { isSecureOrigin } from "@/lib/env";

// Same two names as before, picked by transport rather than by build mode: a
// browser refuses a `__Secure-` cookie over plain HTTP, so a LAN instance must
// use the bare name even though NODE_ENV says production. The un-prefixed one
// is no longer a development-only name, hence _INSECURE rather than _DEV.
const COOKIE_NAME_SECURE = "__Secure-home.wa-challenge";
const COOKIE_NAME_INSECURE = "home.wa-challenge";
const TTL_SECONDS = 5 * 60;

function getSecret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw) throw new Error("AUTH_SECRET is not set");
  return new TextEncoder().encode(raw);
}

function cookieName(): string {
  return isSecureOrigin() ? COOKIE_NAME_SECURE : COOKIE_NAME_INSECURE;
}

export type ChallengeScope = "register" | "login" | "presence";

async function signChallenge(
  challenge: string,
  scope: ChallengeScope,
  userId?: string,
  reauthenticated?: boolean,
): Promise<string> {
  return new SignJWT({ challenge, scope, userId, reauthenticated })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime(`${TTL_SECONDS}s`)
    .setIssuedAt()
    .sign(getSecret());
}

const COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: TTL_SECONDS,
} as const;

/**
 * Attach the challenge cookie to a NextResponse so the Set-Cookie header
 * travels with this exact response. Preferred in Route Handlers — avoids
 * any ambiguity about whether `cookies().set()` propagates.
 */
export async function attachChallengeCookie(
  response: NextResponse,
  challenge: string,
  scope: ChallengeScope,
  userId?: string,
  /**
   * True when the holder proved who they are *again* just before this
   * challenge was minted. It travels inside the signed JWT because the step
   * that spends the challenge is a second request: the caller cannot be asked
   * to re-prove there (a presence assertion is single-use, and its challenge
   * has already been replaced by this one), and it must not be able to claim
   * the proof for itself either. Signed with AUTH_SECRET, so it cannot.
   */
  reauthenticated?: boolean,
): Promise<void> {
  const jwt = await signChallenge(challenge, scope, userId, reauthenticated);
  response.cookies.set({
    name: cookieName(),
    value: jwt,
    ...COOKIE_OPTIONS,
    secure: isSecureOrigin(),
  });
}

/**
 * Clear the challenge cookie on a NextResponse. Used after verify steps.
 *
 * It clears exactly the name `attachChallengeCookie` writes. That is the
 * invariant: one name in, one name out. A read path that accepted a second,
 * older name would spend a challenge this function never clears, and the
 * single-use rule the verify step asserts would silently stop holding.
 */
export function clearChallengeCookieOn(response: NextResponse): void {
  response.cookies.set({
    name: cookieName(),
    value: "",
    ...COOKIE_OPTIONS,
    secure: isSecureOrigin(),
    maxAge: 0,
  });
}

export type ReadChallengeResult =
  | {
      ok: true;
      challenge: string;
      scope: ChallengeScope;
      userId?: string;
      reauthenticated?: boolean;
    }
  | { ok: false; reason: "missing" | "invalid_jwt" };

export async function readChallengeCookie(): Promise<{
  challenge: string;
  scope: ChallengeScope;
  userId?: string;
  reauthenticated?: boolean;
} | null> {
  const r = await readChallengeCookieDetailed();
  return r.ok
    ? {
        challenge: r.challenge,
        scope: r.scope,
        userId: r.userId,
        reauthenticated: r.reauthenticated,
      }
    : null;
}

/**
 * Same as readChallengeCookie but returns a structured failure reason for
 * diagnostic logging in route handlers. Prefer this in new code so 4xx
 * responses can include actionable cause.
 */
export async function readChallengeCookieDetailed(): Promise<ReadChallengeResult> {
  const jar = await cookies();
  const c = jar.get(cookieName());
  if (!c) return { ok: false, reason: "missing" };
  try {
    const { payload } = await jwtVerify(c.value, getSecret());
    return {
      ok: true,
      challenge: String(payload.challenge),
      scope: payload.scope as ChallengeScope,
      userId: payload.userId ? String(payload.userId) : undefined,
      reauthenticated: payload.reauthenticated === true,
    };
  } catch {
    return { ok: false, reason: "invalid_jwt" };
  }
}

/**
 * Clear via cookies() jar — only used from contexts without a response object
 * (e.g., NextAuth `authorize` callback).
 */
export async function clearChallengeCookie(): Promise<void> {
  const jar = await cookies();
  jar.delete(cookieName());
}
