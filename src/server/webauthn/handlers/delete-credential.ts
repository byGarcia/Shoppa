import "server-only";

import { authMode } from "@/lib/env";
import { prisma } from "@/server/db";

export type CredentialDeletion =
  | { ok: true; deviceName: string; remaining: number }
  | {
      ok: false;
      /**
       * The id names no credential of this account — either because no such row
       * exists or because it belongs to somebody else. One reason for both, on
       * purpose: two reasons would answer "is this id somebody's?" for anybody
       * holding a session.
       */
      reason: "not-found";
    }
  | {
      ok: false;
      /**
       * Deleting it would leave the account with nothing that opens it. Named
       * apart from "not-found" because the card has something to say about it
       * and nothing to say about the other.
       */
      reason: "last-credential";
    };

/**
 * Delete one of the session holder's own passkeys, or refuse and say why.
 *
 * Two refusals and they are different things. `not-found` is "that is not
 * yours"; `last-credential` is "it is yours, and it is the only way into this
 * account".
 *
 * **The guard, and why it is here rather than in the card.** An account
 * migrated from the previous application has no password: its passkeys are the
 * whole of how anybody gets in, and this release has no screen that sets a
 * password back. Deleting the last one is therefore not a mistake somebody
 * recovers from by trying again — it is a locked door with `scripts/auth-
 * password.mjs` and a shell on the server behind it. An interface can hide the
 * bin, and this one does, but hiding a control is a courtesy: a second tab, a
 * stale list or a replayed request all reach the route with the control never
 * having been on anybody's screen.
 *
 * **Under a race.** Two deletions arriving together for the last two
 * credentials both read "there are two" and both delete, leaving none — the
 * textbook write skew, and it does not need an attacker: two phones, one list
 * each, one tap each. What decides is `SELECT … FOR UPDATE` on the account's
 * own row, taken before the count is read. The second transaction blocks on the
 * lock, and by the time it reads the count the first has committed, so it sees
 * one credential and refuses. The lock is on `users` rather than on the
 * credentials because the invariant is the account's, not any one row's: it is
 * the only object both transactions are guaranteed to touch.
 *
 * The same lock orders this against a registration, which updates the same user
 * row to clear the password. Whichever commits first, the other reads the state
 * it left, and there is no ordering in which the account ends up with neither a
 * password nor a key.
 */
export async function deleteOwnCredential(
  userId: string,
  credentialRowId: string,
): Promise<CredentialDeletion> {
  // A password is only a way in if this instance accepts one. With
  // AUTH_MODE=passkey, authorizePassword refuses every attempt (see
  // src/lib/auth-password.ts), so a hash left over from a console rescue opens
  // nothing and must not be allowed to authorise deleting the last key.
  const passwordOpensTheDoor = authMode() !== "passkey";

  return prisma.$transaction(async (tx) => {
    // Taken first and held to commit. Everything below is read under it.
    const locked = await tx.$queryRaw<Array<{ password_hash: string | null }>>`
      SELECT password_hash FROM users WHERE id = ${userId} FOR UPDATE
    `;
    const account = locked[0];
    // A session for an account that no longer exists gets the same answer as
    // one naming a credential that is not its own.
    if (!account) return { ok: false, reason: "not-found" };

    // Scoped by userId, so somebody else's credential is simply not found. The
    // row is read before the count so that a bogus id is answered "not found"
    // rather than "that is your last one", which would be a sentence about an
    // account state the id has nothing to do with.
    const credential = await tx.webAuthnCredential.findFirst({
      where: { id: credentialRowId, userId },
      select: { deviceName: true },
    });
    if (!credential) return { ok: false, reason: "not-found" };

    const total = await tx.webAuthnCredential.count({ where: { userId } });
    const hasUsablePassword = passwordOpensTheDoor && account.password_hash !== null;
    if (!hasUsablePassword && total <= 1) return { ok: false, reason: "last-credential" };

    // `deleteMany` with both columns rather than `delete` by id: the ownership
    // is written into the statement that removes the row, not only into the
    // read above it.
    await tx.webAuthnCredential.deleteMany({ where: { id: credentialRowId, userId } });
    return { ok: true, deviceName: credential.deviceName, remaining: total - 1 };
  });
}
