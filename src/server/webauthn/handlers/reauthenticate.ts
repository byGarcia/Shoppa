import "server-only";

import { z } from "zod";

import { isThrottled, recordFailure } from "@/lib/login-throttle";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/server/db";

import { verifyWebAuthnAssertion } from "../credentials-authorize";

/**
 * Proof of who is holding the session, demanded again before a passkey is
 * registered.
 *
 * A session on its own is not enough authority for this one operation.
 * Registering a passkey deletes the account's password, this release has no
 * route to delete a credential or set a password again, and the only way back
 * is a shell on the server. So one tap from a borrowed device — a 30-day JWT on
 * a phone somebody left unlocked — would attach an attacker's authenticator and
 * destroy the owner's way in, permanently.
 *
 * The proof is whatever the account can actually produce: its current password
 * if it has one, and otherwise an assertion from an authenticator it already
 * has, through the "presence" challenge scope.
 */
export const reauthSchema = {
  currentPassword: z.string().min(1).optional(),
  presenceAssertion: z.string().min(1).optional(),
};

export interface ReauthInput {
  currentPassword?: string;
  presenceAssertion?: string;
}

/** Which proof this account is able to give. */
export type ReauthMethod = "password" | "presence";

export type ReauthResult =
  | { ok: true }
  | { ok: false; reason: "wrong-password" | "throttled" | "no-proof" | "unprovable" };

/**
 * What the settings card is allowed to know about the account holding the
 * session: which proof it can give, and the two facts it needs to describe the
 * operation truthfully before running it.
 *
 * Nothing here is about anybody else, and the hash never leaves this module —
 * `hasPassword` is the one bit of it the holder already knows.
 */
export interface PasskeyAccountState {
  /** Which proof this account can give, or null when it can give none. */
  reauth: ReauthMethod | null;
  /** Whether a password exists at all. Never the hash, nor any part of it. */
  hasPassword: boolean;
  /** How many passkeys the account already has. */
  passkeyCount: number;
}

/**
 * The same row `reauthenticate` reads, answered before anything is written.
 *
 * The card used to assert that adding a passkey destroys the password, for
 * every account, because it had nothing to ask. For an account migrated from an
 * older installation — no password, one passkey — every clause of that was
 * false, and the button offered a deletion that could not happen. The branch
 * below is the one `reauthenticate` already takes; this only says it out loud.
 */
export async function passkeyAccountStateFor(userId: string): Promise<PasskeyAccountState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, _count: { select: { webauthnCredentials: true } } },
  });
  // A session for an account that no longer exists proves nothing and is told
  // nothing: same shape as the account that cannot confirm itself.
  if (!user) return { reauth: null, hasPassword: false, passkeyCount: 0 };

  const hasPassword = user.passwordHash !== null;
  const passkeyCount = user._count.webauthnCredentials;
  // An account with neither a password nor a credential cannot be signed into
  // at all, so a session for it should not exist. If one does, it cannot prove
  // anything and is refused rather than waved through.
  const reauth: ReauthMethod | null = hasPassword
    ? "password"
    : passkeyCount > 0
      ? "presence"
      : null;
  return { reauth, hasPassword, passkeyCount };
}

export async function reauthenticate(
  userId: string,
  input: ReauthInput,
): Promise<ReauthResult> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true, _count: { select: { webauthnCredentials: true } } },
  });
  if (!user) return { ok: false, reason: "unprovable" };

  if (user.passwordHash) {
    if (!input.currentPassword) return { ok: false, reason: "no-proof" };
    // The same per-account counter the sign-in uses. Without it this would be a
    // second door to the same password with no throttle behind it, and the IP
    // bucket in src/proxy.ts is the only other bound — which had to be widened
    // to twelve so a three-round-trip ceremony could be retried at all.
    //
    // recordFailure but never recordSuccess: a success here would mint the
    // exemption from the instance-wide ceiling, and that exemption may only
    // come from the sign-in path (Task 6). Counting failures only tightens.
    if (isThrottled(user.email)) return { ok: false, reason: "throttled" };
    const good = await verifyPassword(input.currentPassword, user.passwordHash);
    if (!good) {
      recordFailure(user.email);
      return { ok: false, reason: "wrong-password" };
    }
    return { ok: true };
  }

  if (user._count.webauthnCredentials === 0) return { ok: false, reason: "unprovable" };
  if (!input.presenceAssertion) return { ok: false, reason: "no-proof" };

  // "presence", never "login": a challenge minted to sign in must not be
  // spendable as proof for an irreversible change, and the scope lives inside
  // the signed cookie exactly so the two cannot be swapped.
  // Not counted against the throttle: an assertion holds no guessable secret,
  // so failures here prove nothing and counting them would hand anybody with a
  // session a way to lock the owner out of password sign-in.
  const result = await verifyWebAuthnAssertion(user.email, input.presenceAssertion, {
    expectedScope: "presence",
  });
  if (!result.ok) return { ok: false, reason: "wrong-password" };
  // The assertion proves control of *an* account; it has to be this one.
  if (result.user.id !== userId) return { ok: false, reason: "wrong-password" };
  return { ok: true };
}
