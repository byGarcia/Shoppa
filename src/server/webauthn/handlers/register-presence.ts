import "server-only";
import type { NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";

import { prisma } from "@/server/db";

import { attachChallengeCookie } from "../challenge-cookie";
import { WEBAUTHN_CONFIG } from "../config";
import type { WebAuthnHandlerDeps } from "./types";
import { apiText } from "@/lib/api-messages";

/**
 * The challenge for the re-authentication a passkey-only account performs
 * before registering another authenticator.
 *
 * Scope "presence", not "login": the assertion this produces cannot be used to
 * sign anybody in, and a sign-in challenge cannot be used as proof here. The
 * scope is a claim of the signed cookie, so neither substitution is available
 * to the caller.
 */
export function makeRegisterPresenceHandler(
  deps: Pick<WebAuthnHandlerDeps, "handleApiError" | "ApiResponse" | "getOptionalAuthSession">,
) {
  return async function registerPresenceHandler(): Promise<NextResponse> {
    try {
      const session = await deps.getOptionalAuthSession();
      if (!session) return deps.ApiResponse.unauthorized();

      const credentials = await prisma.webAuthnCredential.findMany({
        where: { userId: session.user.id },
        select: { credentialId: true, transports: true },
      });
      if (credentials.length === 0) return deps.ApiResponse.badRequest(await apiText("webauthn.nothingToConfirmWith"));

      const options = await generateAuthenticationOptions({
        rpID: WEBAUTHN_CONFIG.rpID,
        allowCredentials: credentials.map((c) => ({
          id: c.credentialId,
          transports: c.transports as AuthenticatorTransport[],
        })),
        userVerification: "required",
      });

      const response = deps.ApiResponse.success(options);
      await attachChallengeCookie(response, options.challenge, "presence", session.user.id);
      return response;
    } catch (error) {
      return deps.handleApiError(error, "POST /api/auth/webauthn/register?step=presence");
    }
  };
}
