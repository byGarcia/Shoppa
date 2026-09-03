import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { serverTranslations } from "@/lib/api-messages";

import { normalizeEmail } from "@/lib/email";
import { hashPassword } from "@/lib/password";

import { prisma } from "./db";

/**
 * Everybody after the first person.
 *
 * The first run has an authority nobody can hold twice — the instance is
 * claimed once and never again (src/server/setup.ts). An invitation is the same
 * problem with a different authority: a secret that authorises exactly one
 * account creation, and the difference between "one" and "one per attempt" is
 * decided by the database, not by application code that reads and then writes.
 *
 * So redemption copies the claim's shape exactly: a conditional
 * `UPDATE … WHERE used_at IS NULL` inside the same transaction that creates the
 * user and its authenticator, with zero rows updated meaning "I did not obtain
 * this invitation". Two people opening the same link at the same moment, or one
 * person replaying the request, get one account between them.
 *
 * Only the SHA-256 of the token is stored. A database read — a backup, a
 * `psql` session, a leaked dump — yields nothing that can be redeemed, and the
 * plaintext exists exactly once, in the response to the member who created it.
 */

/** 72 hours, per the release design. A link that lives forever is a password. */
export const INVITATION_TTL_MS = 72 * 60 * 60 * 1000;

/**
 * SHA-256, hex. Deterministic on purpose: the lookup is a unique-index hit
 * rather than a scan, so there is no timing signal to read, and no per-row salt
 * to store. The token itself carries 192 bits of entropy, which is what makes a
 * plain hash enough here — unlike a password, nobody can guess this one.
 */
export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function createInvitation(
  userId: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  await prisma.invitation.create({
    data: { tokenHash: hashInvitationToken(token), expiresAt, createdByUserId: userId },
  });
  // The only time the plaintext is ever readable. It is not stored, not logged
  // and not recoverable: losing it means creating another invitation.
  return { token, expiresAt };
}

export type InvitationRefusal = "unknown" | "expired" | "used";

/**
 * Is this token worth showing a form for?
 *
 * Read-only, and deliberately NOT a redemption: the passkey ceremony asks about
 * the authority twice (options, then verify) and the screen asks a third time
 * before it draws anything. Spending the invitation on any of those would burn
 * it before the account exists. The single-use guarantee lives in
 * redeemInvitation and nowhere else; this answers "would that call refuse?",
 * which is a question whose answer may go stale and does no harm when it does.
 */
export async function inspectInvitation(
  token: string,
): Promise<{ ok: true } | { ok: false; reason: InvitationRefusal }> {
  const row = await prisma.invitation.findUnique({
    where: { tokenHash: hashInvitationToken(token) },
    select: { usedAt: true, expiresAt: true },
  });
  const refusal = refusalFor(row);
  return refusal ? { ok: false, reason: refusal } : { ok: true };
}

/** A credential the WebAuthn ceremony has already verified. */
export interface InvitationCredential {
  credentialId: string;
  publicKey: string;
  counter: bigint;
  transports: string[];
  deviceName: string;
}

export interface RedeemInput {
  token: string;
  email: string;
  password?: string;
  /** Set by the passkey path once the attestation has been verified. */
  credential?: InvitationCredential;
}

export type RedeemRefusal =
  | InvitationRefusal
  | "invalid"
  | "email-taken"
  | "credential-taken";

export type RedeemResult = { ok: true; userId: string } | { ok: false; reason: RedeemRefusal };

/**
 * What to tell the person holding the link.
 *
 * One definition because three surfaces say it — the screen, its API route and
 * the passkey ceremony — and three copies of the same sentence is three chances
 * for them to disagree about what just happened. Every refusal names the way
 * out: the only thing the invited person can do about any of them is ask for
 * another link.
 */
export async function invitationRefusalMessage(reason: RedeemRefusal): Promise<string> {
  const t = await serverTranslations("api.invitations");
  switch (reason) {
    case "unknown":
      return t("unknown");
    case "expired":
      return t("expired");
    case "used":
      return t("used");
    case "email-taken":
      return t("emailTaken");
    case "credential-taken":
      return t("passkeyTaken");
    case "invalid":
      return t("missingFields");
  }
}

export async function redeemInvitation(input: RedeemInput): Promise<RedeemResult> {
  if (!input.password && !input.credential) return { ok: false, reason: "invalid" };

  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, reason: "invalid" };

  const tokenHash = hashInvitationToken(input.token);

  // Look at the invitation BEFORE deriving anything.
  //
  // This read decides nothing — the conditional UPDATE below still does, and it
  // has to, because between this line and that one somebody else may take the
  // invitation. It is here for cost. hashPassword is scrypt at N=65536, r=8:
  // roughly 64 MiB of memory and 100-plus milliseconds per call, on a machine
  // whose whole point is that it might be a Raspberry Pi. `/api/invitations/
  // redeem` is public, so without this a stranger posting garbage tokens makes
  // this instance derive a key per request — 64 MiB times the four libuv
  // threadpool slots — for an invitation that was never going to be redeemed.
  // Measured: 140-165 ms for a bogus token, against 8-21 ms once zod refuses.
  //
  // claimInstance does exactly this and it is why the ordering there reads the
  // way it does: setupTokenMatches first, hashPassword after.
  const known = await inspectInvitation(input.token);
  if (!known.ok) return { ok: false, reason: known.reason };

  // Same rule as the first-run claim: a passkey wins outright. When the
  // ceremony produced a credential no hash is stored at all, so "registering a
  // passkey means the account has no password" holds from the account's first
  // instant instead of being applied to it afterwards.
  const passwordHash =
    input.credential || !input.password ? null : await hashPassword(input.password);

  try {
    const userId = await prisma.$transaction(async (tx) => {
      // Expiry is part of the same statement, not a check before it. An expired
      // invitation matches zero rows and therefore is not marked used, which
      // keeps "expired" and "used" two distinct facts about the row rather than
      // one overwriting the other.
      const taken = await tx.$executeRaw`
        UPDATE invitations SET used_at = now()
        WHERE token_hash = ${tokenHash} AND used_at IS NULL AND expires_at > now()`;
      if (taken === 0) {
        // Zero rows is "I did not obtain this invitation", and the reason is
        // read here, inside the transaction, AFTER the update has already
        // failed to match. That ordering matters: a concurrent redemption holds
        // the row lock until it commits, our UPDATE waits for it, and only then
        // does this read run — against a fresh snapshot that sees the winner's
        // `used_at`. Reading first and deciding afterwards is precisely the
        // check-then-act this statement exists to avoid.
        const row = await tx.invitation.findUnique({
          where: { tokenHash },
          select: { usedAt: true, expiresAt: true },
        });
        throw new NotRedeemed(refusalFor(row) ?? "used");
      }

      const user = await tx.user.create({ data: { email, passwordHash }, select: { id: true } });
      if (input.credential) {
        await tx.webAuthnCredential.create({ data: { userId: user.id, ...input.credential } });
      }
      // Who came in through this link, written in the same transaction as the
      // account itself. It is a second statement only because the id does not
      // exist until the row above does; it lives or dies with everything else
      // here. It is also what tells a redeemed invitation from a revoked one,
      // which share the `used_at` marker on purpose.
      await tx.invitation.update({
        where: { tokenHash },
        data: { redeemedByUserId: user.id },
      });
      return user.id;
    });
    return { ok: true, userId };
  } catch (error) {
    if (error instanceof NotRedeemed) return { ok: false, reason: error.reason };
    // A unique violation, and WHICH one matters. Both writes in this
    // transaction have a unique index behind them, and reporting either as
    // "that address is taken" would tell the invited person something false
    // about somebody else's account. Because it fires inside the transaction
    // the invitation rolls back unused either way: they can try again with the
    // address, or the authenticator, they meant.
    if (isUniqueViolation(error, "User")) return { ok: false, reason: "email-taken" };
    if (isUniqueViolation(error, "WebAuthnCredential")) {
      return { ok: false, reason: "credential-taken" };
    }
    throw error;
  }
}

/**
 * Why a row cannot be redeemed, or null if it can.
 *
 * "Used" beats "expired": an invitation redeemed inside its window and looked
 * at afterwards was spent, and that is the truer thing to say about it. An
 * absent row is "unknown" — the same answer a token this instance never issued
 * gets, so a wrong guess learns nothing about which tokens once existed.
 */
function refusalFor(
  row: { usedAt: Date | null; expiresAt: Date } | null,
): InvitationRefusal | null {
  if (!row) return "unknown";
  if (row.usedAt) return "used";
  if (row.expiresAt.getTime() <= Date.now()) return "expired";
  return null;
}

/**
 * A P2002 raised by a write against `model`.
 *
 * The discriminator is `meta.modelName`, not `meta.target`. Under Prisma 7 with
 * the pg driver adapter there is no `target`: the payload is
 * `{ modelName, driverAdapterError: { cause: { constraint: { fields } } } }`,
 * and the constraint name arrives mangled for an expression index — the one on
 * `lower(email)` comes through as the field `"lower(email"`. Measured against
 * this project's own database rather than assumed. `modelName` says which table
 * refused, which is the whole question here.
 */
function isUniqueViolation(error: unknown, model: "User" | "WebAuthnCredential"): boolean {
  if (typeof error !== "object" || error === null) return false;
  const e = error as { code?: unknown; meta?: { modelName?: unknown } };
  return e.code === "P2002" && e.meta?.modelName === model;
}

class NotRedeemed extends Error {
  constructor(readonly reason: InvitationRefusal) {
    super(reason);
  }
}

/**
 * What a pending invitation is, seen from the settings screen.
 *
 * "revoked" and "redeemed" share the `used_at` marker, so they are told apart
 * by whether anybody came in: `redeemed_by_user_id`. That is the honest reading
 * in every case but one — deleting the account that was let in sets the column
 * null (the alternative, cascading, would delete the record that anybody was
 * let in at all) and its row then reads "revoked". There is no route in this
 * application that deletes a user; it takes a hand on `psql`.
 */
export type InvitationState = "pending" | "expired" | "redeemed" | "revoked";

export interface InvitationSummary {
  id: string;
  state: InvitationState;
  createdAt: Date;
  expiresAt: Date;
  usedAt: Date | null;
  /** Who sent it. */
  createdByEmail: string;
  /** Who came in, when anybody did. */
  redeemedByEmail: string | null;
}

/**
 * Every invitation of this instance, not only the caller's.
 *
 * An invitation is a key to the whole household's list, so who may see and
 * revoke one is the household, not the person who happened to press the button.
 * The alternative — each member sees only their own — means a lost phone whose
 * owner cannot log in leaves links nobody else can even enumerate, which is the
 * exact situation this screen exists for.
 *
 * The token hash is never selected. There is nothing to do with it and it has
 * no business travelling to a browser.
 */
export async function listInvitations(): Promise<InvitationSummary[]> {
  const rows = await prisma.invitation.findMany({
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      createdAt: true,
      expiresAt: true,
      usedAt: true,
      redeemedByUserId: true,
      createdBy: { select: { email: true } },
      redeemedBy: { select: { email: true } },
    },
  });
  return rows.map((row) => ({
    id: row.id,
    state: stateOf(row),
    createdAt: row.createdAt,
    expiresAt: row.expiresAt,
    usedAt: row.usedAt,
    createdByEmail: row.createdBy.email,
    redeemedByEmail: row.redeemedBy?.email ?? null,
  }));
}

function stateOf(row: {
  usedAt: Date | null;
  expiresAt: Date;
  redeemedByUserId: string | null;
}): InvitationState {
  if (row.usedAt) return row.redeemedByUserId ? "redeemed" : "revoked";
  return row.expiresAt.getTime() <= Date.now() ? "expired" : "pending";
}

/**
 * Take a pending invitation back.
 *
 * Revoking a session does not revoke the links that session created: bumping
 * `token_version` on a lost phone logs it out and leaves every invitation it
 * minted good for up to 72 hours. This is how those are taken back.
 *
 * It is the SAME conditional UPDATE the redemption uses, on the same column, so
 * a revocation and a redemption arriving together are decided by Postgres and
 * not by whichever handler happened to read first: one takes the row, the other
 * matches zero rows and reports the truth. A separate `revoked_at` column would
 * have been a second marker to remember in the redemption's WHERE clause, and
 * forgetting it there is a revoked link that still opens the door.
 *
 * Returns false when there was nothing to take back — already used, already
 * revoked, or no such invitation. Not an error: all three mean the same thing
 * to the person pressing the button, which is that the link is dead.
 */
export async function revokeInvitation(id: string): Promise<boolean> {
  const revoked = await prisma.$executeRaw`
    UPDATE invitations SET used_at = now() WHERE id = ${id} AND used_at IS NULL`;
  return revoked > 0;
}
