import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { normalizeEmail } from "@/lib/email";
import { hashPassword } from "@/lib/password";

import { prisma } from "./db";

/**
 * First run.
 *
 * The gate is "the instance has not been claimed", not "no credential exists":
 * those differ the moment the first account uses a password, and the wrong one
 * leaves registration open for good.
 *
 * The claim is a conditional UPDATE inside the same transaction that creates
 * the account. Postgres locks the row, so of two concurrent claims one gets a
 * row back and the other gets none and rolls back whole. Counting users first
 * and deciding in application code does not survive that race, and it is
 * precisely the request an attacker would send twice.
 */

/**
 * The installation token. DERIVED, never memoised.
 *
 * `let token = randomBytes(...)` looks like it holds one value per process and
 * does not: Next compiles the middleware bundle separately from the route
 * bundles, so this module is instantiated more than once inside one process and
 * each copy draws its own random value. The token printed at boot then belongs
 * to the proxy's copy while the one `/api/setup` checks belongs to another, and
 * a fresh instance can never be claimed at all — bricked at first run, with the
 * useless token reprinted on every boot. Reproduced on the shipping
 * configuration (`next build` + `next start`, the Dockerfile CMD): the boot
 * printed one token and `/api/setup` answered 403 to it.
 *
 * `globalThis` is not the fix either — it would hide this inside one process
 * and not across workers.
 *
 * Deriving it from AUTH_SECRET gives every bundle, worker and restart the same
 * answer with nothing to persist and no schema change. It is only meaningful
 * while the instance is unclaimed, and whoever knows AUTH_SECRET is the
 * operator already.
 */
export function setupToken(): string {
  const explicit = process.env.SETUP_TOKEN;
  if (explicit) return explicit;
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error("AUTH_SECRET is not set: without it there is no installation token.");
  }
  return createHmac("sha256", secret).update("shoppa:setup-token").digest("base64url").slice(0, 32);
}

/** Constant-time comparison. The length check leaks only the length. */
export function setupTokenMatches(candidate: string): boolean {
  const expected = Buffer.from(setupToken());
  const given = Buffer.from(candidate);
  if (expected.length !== given.length) return false;
  return timingSafeEqual(expected, given);
}

/**
 * Claimed if the marker is set OR any user exists.
 *
 * The two are not the same, and they come apart: `claimed_at` was back-filled
 * only for the users present when the migration ran, and any row written to
 * `users` from outside the claim path — a restore, a hand-run INSERT — leaves
 * the marker untouched. An instance in that state would redirect its own
 * household to /setup, a hard lockout, and hand the next visitor an open
 * registration window alongside the accounts that already exist.
 *
 * A missing row fails closed too. The CHECK constraint keeps that row unique,
 * not mandatory: somebody who deletes it leaves an instance whose claim can
 * never succeed, and answering "unclaimed" there would send every visitor to a
 * setup screen that cannot work while leaving registration nominally open.
 */
export async function isClaimed(): Promise<boolean> {
  const [row, users] = await Promise.all([
    prisma.instanceSetup.findUnique({ where: { id: "singleton" }, select: { claimedAt: true } }),
    prisma.user.count(),
  ]);
  if (!row) return true;
  return Boolean(row.claimedAt) || users > 0;
}

/** A credential the WebAuthn ceremony has already verified. */
export interface ClaimCredential {
  credentialId: string;
  publicKey: string;
  counter: bigint;
  transports: string[];
  deviceName: string;
}

export interface ClaimInput {
  token: string;
  email: string;
  password?: string;
  /** Set by the passkey path once the attestation has been verified. */
  credential?: ClaimCredential;
}

export type ClaimResult =
  | { ok: true; userId: string }
  | { ok: false; reason: "already-claimed" | "bad-token" | "invalid" };

export async function claimInstance(input: ClaimInput): Promise<ClaimResult> {
  if (!setupTokenMatches(input.token)) return { ok: false, reason: "bad-token" };
  if (!input.password && !input.credential) return { ok: false, reason: "invalid" };

  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: "invalid" };

  // A passkey wins outright: if the ceremony produced a credential, no hash is
  // stored at all, so the rule "registering a passkey deletes the password"
  // holds from the very first account rather than being applied afterwards.
  const passwordHash =
    input.credential || !input.password ? null : await hashPassword(input.password);

  try {
    const userId = await prisma.$transaction(async (tx) => {
      // Both conditions in the one statement, under the same row lock: the
      // marker AND the absence of users. Checking the users table separately
      // would reopen the race the conditional update exists to close.
      const claimed = await tx.$executeRaw`
        UPDATE instance_setup SET claimed_at = now()
        WHERE id = 'singleton' AND claimed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM users)`;
      // Zero rows is "I did not obtain the claim". It covers the race (somebody
      // committed first), the absent row, and an instance whose marker was
      // never set but which already has accounts. None of the three is a state
      // in which an account may be created.
      if (claimed === 0) throw new AlreadyClaimed();

      const user = await tx.user.create({
        data: { email, passwordHash },
        select: { id: true },
      });
      if (input.credential) {
        await tx.webAuthnCredential.create({ data: { userId: user.id, ...input.credential } });
      }
      return user.id;
    });
    return { ok: true, userId };
  } catch (error) {
    if (error instanceof AlreadyClaimed) return { ok: false, reason: "already-claimed" };
    throw error;
  }
}

class AlreadyClaimed extends Error {}
