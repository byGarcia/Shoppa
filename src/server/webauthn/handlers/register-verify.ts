import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { verifyRegistrationResponse } from "@simplewebauthn/server";
import type { VerifyRegistrationResponseOpts } from "@simplewebauthn/server";

import { normalizeEmail } from "@/lib/email";
import { Prisma, prisma } from "@/server/db";
import { invitationRefusalMessage, redeemInvitation } from "@/server/invitations";
import { recordSecurityEvent } from "@/server/security-log";
import { claimInstance } from "@/server/setup";

import { clearChallengeCookieOn, readChallengeCookie } from "../challenge-cookie";
import { WEBAUTHN_CONFIG } from "../config";
import { registrationAuthoritySchema, resolveRegistrationGrant } from "./registration-grant";
import type { WebAuthnHandlerDeps } from "./types";
import { apiText } from "@/lib/api-messages";

type RegistrationResponseJSON = VerifyRegistrationResponseOpts["response"];

const bodySchema = z.object({
  // See register-options.ts: `.trim()` first, or the schema contradicts the
  // primitive it guards.
  email: z.string().trim().email().optional(),
  deviceName: z.string().trim().min(1).max(80).optional(),
  attestation: z.string().min(1),
  ...registrationAuthoritySchema,
});



/**
 * Second round trip: verify the attestation and store the credential.
 *
 * Two things happen here that cannot be delegated to the first round trip:
 *
 *  1. **The authority is checked again.** A ceremony is two requests, and the
 *     one that writes to the database is this one.
 *  2. **The re-authentication is demanded again**, in the only form this step
 *     can demand it: the `reauthenticated` claim of the signed challenge
 *     cookie, minted by register-options once the proof was given. A presence
 *     assertion is single-use and its challenge has already been replaced by
 *     this one, so re-proving here is not available; a claim the caller cannot
 *     forge is.
 *  3. **The credential and the password move together.** Wherever a
 *     WebAuthnCredential is created, `password_hash` is cleared in the same
 *     transaction — on the paths that create an account (claimInstance,
 *     redeemInvitation) by storing no hash at all when the ceremony carried a
 *     credential, and here, for a member, by the transaction below. A passkey that leaves the old password alive means the
 *     account is still openable by the weaker of the two factors, which is the
 *     opposite of what registering a passkey is understood to mean.
 */
export function makeRegisterVerifyHandler(
  deps: Pick<WebAuthnHandlerDeps, "handleApiError" | "ApiResponse" | "getOptionalAuthSession">,
) {
  return async function registerVerifyHandler(request: NextRequest): Promise<NextResponse> {
    try {
      const json = await request.json().catch(() => ({}));
      const body = bodySchema.parse(json);

      const session = await deps.getOptionalAuthSession();
      const authorised = await resolveRegistrationGrant(body, session);
      if (!authorised.ok) return deps.ApiResponse.unauthorized();
      const grant = authorised.grant;

      // Every response from here on clears the challenge cookie, failures
      // included. A challenge that survives its own rejection is one an
      // attacker gets to try again against; it is single-use or it is not a
      // challenge.
      // Takes the response as a promise too: ApiResponse now reads its message
      // from the request's catalog, so the refusals it wraps arrive awaited.
      const spent = async (response: NextResponse | Promise<NextResponse>): Promise<NextResponse> => {
        const resolved = await response;
        clearChallengeCookieOn(resolved);
        return resolved;
      };

      const challenge = await readChallengeCookie();
      if (!challenge || challenge.scope !== "register") {
        return spent(deps.ApiResponse.badRequest(await apiText("webauthn.challengeExpired")));
      }
      // A challenge belongs to the account it was minted for. For a member it
      // must be theirs; where the account does not exist yet — first run or
      // invitation — it must carry no account at all.
      const boundTo = grant.kind === "session" ? grant.userId : undefined;
      if (challenge.userId !== boundTo) return spent(deps.ApiResponse.unauthorized());

      // The proof of identity given at the options step, carried in the signed
      // cookie. Absent means the challenge was minted without it — a
      // register-options that skipped the check, or a challenge lifted from
      // somewhere else — and this is the step that cannot be undone.
      if (grant.kind === "session" && challenge.reauthenticated !== true) {
        return spent(deps.ApiResponse.unauthorized());
      }

      const attestation = JSON.parse(body.attestation) as RegistrationResponseJSON;
      const verification = await verifyRegistrationResponse({
        response: attestation,
        expectedChallenge: challenge.challenge,
        expectedOrigin: WEBAUTHN_CONFIG.origin,
        expectedRPID: WEBAUTHN_CONFIG.rpID,
        requireUserVerification: true,
      });

      if (!verification.verified || !verification.registrationInfo) {
        return spent(deps.ApiResponse.badRequest(await apiText("webauthn.verifyFailed")));
      }

      const registered = verification.registrationInfo.credential;
      const credential = {
        credentialId: registered.id,
        // base64url, the same encoding credentials-authorize.ts decodes with.
        publicKey: Buffer.from(registered.publicKey).toString("base64url"),
        counter: BigInt(registered.counter),
        transports: (registered.transports ?? []) as string[],
        deviceName: body.deviceName ?? await apiText("webauthn.defaultDeviceName"),
      };

      // The two authorities that create an account rather than add to one. Both
      // take their address from the request — there is no session to take it
      // from — and both hand the token to the primitive that spends it, which
      // re-checks it inside the very transaction that writes. The check this
      // handler already did through resolveRegistrationGrant is not the one
      // that decides: it cannot be, because between it and here somebody else
      // may have taken the same authority.
      if (grant.kind === "setup" || grant.kind === "invitation") {
        const email = normalizeEmail(body.email ?? "");
        if (!email) return spent(deps.ApiResponse.badRequest(await apiText("webauthn.missingEmail")));

        if (grant.kind === "setup") {
          const claim = await claimInstance({ token: grant.token, email, credential });
          if (!claim.ok) {
            return spent(
              claim.reason === "bad-token"
                ? deps.ApiResponse.unauthorized()
                : deps.ApiResponse.badRequest(await apiText("webauthn.alreadyClaimed")),
            );
          }
          await recordSecurityEvent({
            eventType: "PASSKEY_REGISTERED",
            userId: claim.userId,
            email,
            endpoint: "/api/auth/webauthn/register",
            details: { via: "setup", deviceName: credential.deviceName },
          });
          return spent(deps.ApiResponse.success({ ok: true, userId: claim.userId }));
        }

        const redeemed = await redeemInvitation({ token: grant.token, email, credential });
        if (!redeemed.ok) {
          return spent(deps.ApiResponse.badRequest(await invitationRefusalMessage(redeemed.reason)));
        }
        await recordSecurityEvent({
          eventType: "PASSKEY_REGISTERED",
          userId: redeemed.userId,
          email,
          endpoint: "/api/auth/webauthn/register",
          details: { via: "invitation", deviceName: credential.deviceName },
        });
        return spent(deps.ApiResponse.success({ ok: true, userId: redeemed.userId }));
      }

      // One transaction: the credential is born and the password dies together,
      // or neither happens.
      try {
        await prisma.$transaction([
          prisma.webAuthnCredential.create({ data: { userId: grant.userId, ...credential } }),
          prisma.user.update({ where: { id: grant.userId }, data: { passwordHash: null } }),
        ]);
      } catch (error) {
        // Re-enrolling an authenticator this instance already knows. The unique
        // index on credential_id is doing its job; surfacing it as a 500 makes
        // a normal mistake look like a broken server.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
          return spent(deps.ApiResponse.badRequest(await apiText("webauthn.credentialTaken")));
        }
        throw error;
      }

      await recordSecurityEvent({
        eventType: "PASSKEY_REGISTERED",
        userId: grant.userId,
        email: grant.email,
        endpoint: "/api/auth/webauthn/register",
        details: { via: "settings", deviceName: credential.deviceName, passwordCleared: true },
      });
      return spent(deps.ApiResponse.success({ ok: true, userId: grant.userId }));
    } catch (error) {
      return deps.handleApiError(error, "POST /api/auth/webauthn/register?step=verify");
    }
  };
}
