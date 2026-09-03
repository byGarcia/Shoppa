import "server-only";
import { normalizeEmail } from "@/lib/email";
import { prisma } from "@/server/db";
import { verifyAuthenticationResponse } from "@simplewebauthn/server";
import type { VerifyAuthenticationResponseOpts } from "@simplewebauthn/server";
import { readChallengeCookie, clearChallengeCookie } from "./challenge-cookie";
import type { ChallengeScope } from "./challenge-cookie";
import { WEBAUTHN_CONFIG } from "./config";

type AuthenticationResponseJSON = VerifyAuthenticationResponseOpts["response"];

export type WebAuthnAuthorizeFailure =
  | "no_challenge"
  | "user_not_found_wa"
  | "credential_unknown"
  | "wa_verify_failed"
  | "counter_regression"
  | "wa_exception";

export interface WebAuthnAuthorizeUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  /**
   * Apps that gate sessions on a server-side `tokenVersion` (mobile) read
   * this; apps that don't (web) ignore it. The helper always returns it
   * if the schema has it, leaving the consumer to decide.
   */
  tokenVersion?: number | null;
}

export type WebAuthnAuthorizeResult =
  | { ok: true; user: WebAuthnAuthorizeUser }
  | { ok: false; user: null; reason: WebAuthnAuthorizeFailure; userId?: string | null; details?: { oldCounter?: number; newCounter?: number; error?: string } };

/**
 * Verify a WebAuthn assertion against the stored credential and the
 * single-use challenge cookie. Returns a structured result; the caller
 * is responsible for security-log writes (each app's logAuthEvent has
 * a different signature).
 *
 * Side effects on success:
 *   - prisma.webAuthnCredential.update with new counter + lastUsedAt
 *   - clearChallengeCookie()
 *
 * Side effects on failure:
 *   - clearChallengeCookie() is NOT called by this helper. The caller
 *     decides whether to clear (mobile clears; web has been letting
 *     the cookie expire on its 5-min TTL). Document the choice.
 */
export async function verifyWebAuthnAssertion(
  email: string,
  assertionRaw: string,
  /**
   * Which challenge this assertion is allowed to spend. Sign-in uses "login";
   * "presence" is the re-authentication a passkey-only account performs before
   * registering another authenticator. The scope is part of the signed cookie
   * precisely so a challenge minted for one purpose cannot be spent on the
   * other, and defaulting it here keeps every existing caller on "login".
   */
  options: { expectedScope?: ChallengeScope } = {},
): Promise<WebAuthnAuthorizeResult> {
  const expectedScope = options.expectedScope ?? "login";
  try {
    const challenge = await readChallengeCookie();
    if (!challenge || challenge.scope !== expectedScope) {
      return { ok: false, user: null, reason: "no_challenge" };
    }

    // Normalised, like the password branch and like registration. Looking the
    // address up raw here is what would have let `Ana@example.com` sign in with
    // a password and fail with a passkey.
    const user = await prisma.user.findUnique({
      where: { email: normalizeEmail(email) },
      select: {
        id: true,
        email: true,
        name: true,
        image: true,
        tokenVersion: true,
        webauthnCredentials: true,
      },
    });
    if (!user) {
      return { ok: false, user: null, reason: "user_not_found_wa" };
    }

    const assertion = JSON.parse(assertionRaw) as AuthenticationResponseJSON;
    const credential = user.webauthnCredentials.find(
      (c) => c.credentialId === assertion.id,
    );
    if (!credential) {
      return { ok: false, user: null, reason: "credential_unknown", userId: user.id };
    }

    const verification = await verifyAuthenticationResponse({
      response: assertion,
      expectedChallenge: challenge.challenge,
      expectedOrigin: WEBAUTHN_CONFIG.origin,
      expectedRPID: WEBAUTHN_CONFIG.rpID,
      credential: {
        id: credential.credentialId,
        publicKey: Buffer.from(credential.publicKey, "base64url"),
        counter: Number(credential.counter),
        transports: credential.transports as AuthenticatorTransport[],
      },
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return { ok: false, user: null, reason: "wa_verify_failed", userId: user.id };
    }

    const newCounter = verification.authenticationInfo.newCounter;
    const oldCounter = Number(credential.counter);
    // Counter regression check (clone protection). Passkeys synced via
    // iCloud always emit newCounter === 0 — expected, skip the check.
    if (oldCounter > 0 && newCounter !== 0 && newCounter <= oldCounter) {
      return {
        ok: false,
        user: null,
        reason: "counter_regression",
        userId: user.id,
        details: { oldCounter, newCounter },
      };
    }

    await prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: {
        counter: BigInt(newCounter),
        lastUsedAt: new Date(),
      },
    });

    await clearChallengeCookie();

    return {
      ok: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        image: user.image,
        tokenVersion: user.tokenVersion,
      },
    };
  } catch (error) {
    return {
      ok: false,
      user: null,
      reason: "wa_exception",
      details: { error: error instanceof Error ? error.message : String(error) },
    };
  }
}
