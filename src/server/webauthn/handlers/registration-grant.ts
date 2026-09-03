import "server-only";

import { z } from "zod";

import { authMode } from "@/lib/env";
import { inspectInvitation } from "@/server/invitations";
import { isClaimed, setupTokenMatches } from "@/server/setup";

import type { AuthenticatedSession } from "./types";

/**
 * Who is allowed to register a passkey, and on what authority.
 *
 * There are three sources of authority and a request carries exactly one:
 *
 *   - a **session** — an existing member adding a passkey from settings;
 *   - the **setup token** — the person installing this instance, before it has
 *     an owner;
 *   - an **invitation** — somebody an existing member invited.
 *
 * "Exactly one" is the whole rule. A request presenting two is refused rather
 * than resolved in some order of preference, and a presented-but-invalid
 * authority is refused rather than retried against a different one: a fallback
 * chain is how "I could not prove I am the installer" turns into "so let me try
 * as a guest", and that is the shape of a bypass.
 *
 * It is resolved at BOTH ends of the ceremony. A registration is two round
 * trips, and checking only the request for options leaves the request that
 * actually stores a credential open to whoever can reach it.
 */
export const registrationAuthoritySchema = {
  setupToken: z.string().min(1).optional(),
  invitationToken: z.string().min(1).optional(),
};

export interface RegistrationAuthorityInput {
  setupToken?: string;
  invitationToken?: string;
}

export type RegistrationGrant =
  /** First run. `email` comes from the request: the account does not exist yet. */
  | { kind: "setup"; token: string }
  /** Somebody a member invited. `email` comes from the request, same as setup. */
  | { kind: "invitation"; token: string }
  /** An existing member. `email` and the account come from the session. */
  | { kind: "session"; userId: string; email: string };

export type GrantRefusal =
  | "no-authority"
  | "ambiguous-authority"
  | "bad-setup-token"
  | "already-claimed"
  | "bad-invitation"
  | "passkeys-disabled";

export type GrantResult =
  | { ok: true; grant: RegistrationGrant }
  | { ok: false; reason: GrantRefusal };

export async function resolveRegistrationGrant(
  input: RegistrationAuthorityInput,
  session: AuthenticatedSession | null,
): Promise<GrantResult> {
  // AUTH_MODE=password refuses every passkey assertion in src/lib/auth.ts, so a
  // passkey registered here could never be used to sign in — and registering
  // one deletes the account's password. Handing somebody a credential that
  // cannot open the door while removing the key that can is a lockout, not a
  // feature, so the mode is checked before anything else.
  if (authMode() === "password") return { ok: false, reason: "passkeys-disabled" };

  const presented =
    (input.setupToken ? 1 : 0) + (input.invitationToken ? 1 : 0) + (session ? 1 : 0);
  if (presented === 0) return { ok: false, reason: "no-authority" };
  if (presented > 1) return { ok: false, reason: "ambiguous-authority" };

  if (input.invitationToken) {
    // Checked, NOT redeemed. Redemption is single-use, and this resolver runs
    // at both ends of a two-round-trip ceremony: spending the invitation here
    // would burn it on the request that hands out a challenge, leaving the
    // person holding an authenticator prompt for an invitation that no longer
    // exists and an account that was never created. The invitation is spent in
    // register-verify, inside the transaction that creates the user — the same
    // division of labour the setup token already follows, where this branch
    // only checks and claimInstance takes the claim.
    const invitation = await inspectInvitation(input.invitationToken);
    if (!invitation.ok) return { ok: false, reason: "bad-invitation" };
    return { ok: true, grant: { kind: "invitation", token: input.invitationToken } };
  }

  if (input.setupToken) {
    if (!setupTokenMatches(input.setupToken)) return { ok: false, reason: "bad-setup-token" };
    if (await isClaimed()) return { ok: false, reason: "already-claimed" };
    return { ok: true, grant: { kind: "setup", token: input.setupToken } };
  }

  // `presented === 1` and neither token was supplied, so there is a session.
  const user = session!.user;
  return { ok: true, grant: { kind: "session", userId: user.id, email: user.email ?? "" } };
}
