import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateRegistrationOptions } from "@simplewebauthn/server";

import { normalizeEmail } from "@/lib/email";
import { prisma } from "@/server/db";

import { attachChallengeCookie } from "../challenge-cookie";
import { WEBAUTHN_CONFIG } from "../config";
import { reauthSchema, reauthenticate } from "./reauthenticate";
import { registrationAuthoritySchema, resolveRegistrationGrant } from "./registration-grant";
import type { WebAuthnHandlerDeps } from "./types";
import { apiText } from "@/lib/api-messages";

const bodySchema = z.object({
  // `.trim()` before `.email()`: zod rejects surrounding whitespace outright,
  // so without it a pasted address with a trailing space is a 400 here while
  // claimInstance would have trimmed it happily — the schema contradicting the
  // primitive it guards.
  email: z.string().trim().email().optional(),
  ...registrationAuthoritySchema,
  ...reauthSchema,
});

/**
 * First round trip of a registration ceremony: hand out a challenge.
 *
 * Public in the sense that it takes no session — but never unauthorised: the
 * grant resolver decides, and it is asked again in register-verify.
 */
export function makeRegisterOptionsHandler(
  deps: Pick<WebAuthnHandlerDeps, "handleApiError" | "ApiResponse" | "getOptionalAuthSession">,
) {
  return async function registerOptionsHandler(request: NextRequest): Promise<NextResponse> {
    try {
      const json = await request.json().catch(() => ({}));
      const body = bodySchema.parse(json);

      const session = await deps.getOptionalAuthSession();
      const authorised = await resolveRegistrationGrant(body, session);
      if (!authorised.ok) return deps.ApiResponse.unauthorized();

      // A session is not enough authority: see reauthenticate.ts. Proof is
      // demanded here, and the fact that it was given travels on into the
      // signed challenge cookie, because the step that actually writes is a
      // second request that cannot ask for it again.
      let reauthenticated = false;
      if (authorised.grant.kind === "session") {
        const proof = await reauthenticate(authorised.grant.userId, body);
        if (!proof.ok) {
          if (proof.reason === "no-proof") {
            return deps.ApiResponse.badRequest(await apiText("webauthn.confirmFirst"));
          }
          return deps.ApiResponse.badRequest(
            await apiText(
              proof.reason === "throttled" ? "webauthn.throttled" : "webauthn.badConfirmation",
            ),
          );
        }
        reauthenticated = true;
      }

      // The address is the session's for a member, and the request's only when
      // the account does not exist yet. A logged-in caller cannot name somebody
      // else's address here.
      const email =
        authorised.grant.kind === "session"
          ? authorised.grant.email
          : normalizeEmail(body.email ?? "");
      if (!email) return deps.ApiResponse.badRequest(await apiText("webauthn.missingEmail"));

      // So the authenticator can refuse to enrol a key this account already has
      // instead of silently creating a duplicate.
      const existing =
        authorised.grant.kind === "session"
          ? await prisma.webAuthnCredential.findMany({
              where: { userId: authorised.grant.userId },
              select: { credentialId: true, transports: true },
            })
          : [];

      const options = await generateRegistrationOptions({
        rpName: WEBAUTHN_CONFIG.rpName,
        rpID: WEBAUTHN_CONFIG.rpID,
        userName: email,
        userDisplayName: email,
        attestationType: "none",
        excludeCredentials: existing.map((c) => ({
          id: c.credentialId,
          transports: c.transports as AuthenticatorTransport[],
        })),
        authenticatorSelection: { residentKey: "preferred", userVerification: "required" },
      });

      const response = deps.ApiResponse.success(options);
      // The cookie carries the user id only for a member's registration. The
      // verify step demands that it match the session, so a challenge minted
      // for one account cannot attach a credential to another — and a challenge
      // minted for a logged-in member cannot be spent on the first-run path.
      await attachChallengeCookie(
        response,
        options.challenge,
        "register",
        authorised.grant.kind === "session" ? authorised.grant.userId : undefined,
        reauthenticated,
      );
      return response;
    } catch (error) {
      return deps.handleApiError(error, "POST /api/auth/webauthn/register?step=options");
    }
  };
}
