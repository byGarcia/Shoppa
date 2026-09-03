import "server-only";

import { z } from "zod";

import { isThrottled, recordFailure } from "@/lib/login-throttle";
import { verifyPassword } from "@/lib/password";
import { prisma } from "@/server/db";

import { verifyWebAuthnAssertion } from "../credentials-authorize";

/**
 * Proof of who is holding the session, demanded again before a passkey is
 * registered — and, since there is one, before a passkey is deleted.
 *
 * A session on its own is not enough authority for either operation, and it is
 * the same reason twice. Registering a passkey deletes the account's password
 * and no screen in this release puts one back; deleting a passkey takes away a
 * way in, and the guard in delete-credential.ts is what stops it taking the
 * last. So one tap from a borrowed device — a 30-day JWT on a phone somebody
 * left unlocked — would otherwise attach an attacker's authenticator, or strip
 * the owner's, with nothing asked of whoever tapped.
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
 * One passkey, as the settings card lists it.
 *
 * Four fields, and the omissions are still the point. The **credential id** —
 * the authenticator's own public handle — stays in this module, along with the
 * public key and the counter: the card has nothing to do with any of them.
 *
 * What did change is that there is now something to name. `DELETE
 * /api/auth/webauthn/credentials/[id]` retires a key, and it needs a handle for
 * the row. That handle is the database row's own id, not the credential id: an
 * opaque cuid that means nothing outside this instance, that the route resolves
 * only against the session's own account, and that carries none of the
 * authenticator's identity. Publishing the credential id instead would put the
 * WebAuthn handle itself on the wire for the sake of a delete button.
 */
export interface PasskeySummary {
  /**
   * The row's id. The only thing here that is a handle, and it is a handle to
   * one operation: deleting this key, by its owner. See
   * src/server/webauthn/handlers/delete-credential.ts.
   */
  id: string;
  /** The readable name the browser was given at registration time. */
  deviceName: string;
  /** ISO 8601, which is what it becomes on the wire anyway. */
  createdAt: string;
  /**
   * ISO 8601, and never null: the column defaults to the insert timestamp, so
   * a credential that has never signed anybody in carries its own creation
   * time. That equality is how the card knows to say "never used" rather than
   * name a date nothing happened on — see src/lib/passkey-addition.ts.
   */
  lastUsedAt: string;
}

/**
 * What the settings card is allowed to know about the account holding the
 * session: which proof it can give, and the facts it needs to describe both the
 * account and the operation truthfully.
 *
 * Nothing here is about anybody else, and the hash never leaves this module —
 * `hasPassword` is the one bit of it the holder already knows.
 */
export interface PasskeyAccountState {
  /** Which proof this account can give, or null when it can give none. */
  reauth: ReauthMethod | null;
  /** Whether a password exists at all. Never the hash, nor any part of it. */
  hasPassword: boolean;
  /** How many passkeys the account already has. Always `passkeys.length`. */
  passkeyCount: number;
  /** Those same passkeys, newest first. What the closed card lists. */
  passkeys: PasskeySummary[];
}

/**
 * The same row `reauthenticate` reads, answered before anything is written.
 *
 * The card used to assert that adding a passkey destroys the password, for
 * every account, because it had nothing to ask. For an account migrated from an
 * older installation — no password, one passkey — every clause of that was
 * false, and the button offered a deletion that could not happen. The branch
 * below is the one `reauthenticate` already takes; this only says it out loud.
 *
 * It also hands back the credentials themselves, which had never been shown
 * anywhere. The count alone left the closed card unable to say more than "add
 * one", to an account that signs in with a passkey every day. The rows replace
 * the `_count` this used to select — a `SELECT count(*)` over exactly these
 * rows — so it is the same query and the same trip, reading three columns of a
 * handful of rows instead of counting them.
 */
export async function passkeyAccountStateFor(userId: string): Promise<PasskeyAccountState> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      passwordHash: true,
      webauthnCredentials: {
        // Four columns and no others: see PasskeySummary for what is left in
        // the table on purpose. `id` is the row's, never `credentialId`.
        select: { id: true, deviceName: true, createdAt: true, lastUsedAt: true },
        // Newest first, like the voice tokens and the invitations, so a key
        // just added is the one at the top.
        orderBy: { createdAt: "desc" },
      },
    },
  });
  // A session for an account that no longer exists proves nothing and is told
  // nothing: same shape as the account that cannot confirm itself.
  if (!user) return { reauth: null, hasPassword: false, passkeyCount: 0, passkeys: [] };

  const hasPassword = user.passwordHash !== null;
  const passkeys = user.webauthnCredentials.map((credential) => ({
    id: credential.id,
    deviceName: credential.deviceName,
    createdAt: credential.createdAt.toISOString(),
    lastUsedAt: credential.lastUsedAt.toISOString(),
  }));
  // Derived rather than counted separately. The count and the list are one
  // fact, and two readings of it are two things the card could show
  // disagreeing — which is the class of defect this whole card keeps hitting.
  const passkeyCount = passkeys.length;
  // An account with neither a password nor a credential cannot be signed into
  // at all, so a session for it should not exist. If one does, it cannot prove
  // anything and is refused rather than waved through.
  const reauth: ReauthMethod | null = hasPassword
    ? "password"
    : passkeyCount > 0
      ? "presence"
      : null;
  return { reauth, hasPassword, passkeyCount, passkeys };
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
