import { prisma } from "@/server/db";

import { normalizeEmail } from "./email";
import { authMode } from "./env";
import { isThrottled, recordFailure, recordSuccess } from "./login-throttle";
import { burnDummyHash, verifyPassword } from "./password";

export type PasswordAuthResult =
  | { ok: true; user: { id: string; email: string; name: string | null; tokenVersion: number } }
  | { ok: false; reason: "disabled" | "throttled" | "no-password" | "bad-credentials" };

/**
 * Password branch of the Credentials provider.
 *
 * Every failure path costs the same key derivation, so "this address has no
 * account" and "this password is wrong" are indistinguishable from outside.
 *
 * The throttle key is the raw submitted address: src/lib/login-throttle.ts
 * normalises it itself, and normalising twice here would only hide that
 * invariant from the next reader.
 */
export async function authorizePassword(
  email: string,
  password: string,
): Promise<PasswordAuthResult> {
  if (authMode() === "passkey") return { ok: false, reason: "disabled" };

  if (isThrottled(email)) {
    // isThrottled short-circuits before verifyPassword, so without this the
    // throttled reply returns in microseconds while an ordinary failure pays
    // a full derivation — a timing oracle for which accounts are under attack,
    // and therefore for which accounts exist.
    //
    // The cost is real and it is not bounded here: a throttled attempt does not
    // increment the instance counter, so an already-throttled account can be
    // made to burn 167 ms of 64 MiB-hard derivation indefinitely. What bounds
    // it is src/proxy.ts, which rate-limits /api/auth/callback to 5 requests
    // per minute per IP, or to 30 per minute for the whole route via
    // checkRouteCeiling when TRUSTED_PROXY=none leaves no client address to
    // key on. Not incrementing the counter here is deliberate: it would let a
    // spray against one throttled account engage the instance ceiling, and a
    // fast rejection there would time-distinguish the accounts exempt from it.
    await burnDummyHash();
    return { ok: false, reason: "throttled" };
  }

  const user = await prisma.user.findUnique({
    where: { email: normalizeEmail(email) },
    select: { id: true, email: true, name: true, tokenVersion: true, passwordHash: true },
  });

  if (!user || !user.passwordHash) {
    await burnDummyHash();
    // Counted whether or not the account exists. Counting only real accounts
    // would make the throttle a cleaner enumeration oracle than the one the
    // dummy derivation above closes: six probes, and a refusal to answer means
    // the address is registered.
    recordFailure(email);
    return { ok: false, reason: user ? "no-password" : "bad-credentials" };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    recordFailure(email);
    return { ok: false, reason: "bad-credentials" };
  }

  // Only here, on a fully verified credential. recordSuccess grants an
  // exemption from the instance-wide ceiling that bounds how much scrypt an
  // attacker can burn; minting it on a "user exists" branch would make the
  // exemption attacker-mintable and the ceiling would stop bounding anything.
  recordSuccess(email);
  return {
    ok: true,
    user: { id: user.id, email: user.email, name: user.name, tokenVersion: user.tokenVersion },
  };
}
