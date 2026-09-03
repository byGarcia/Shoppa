import "server-only";
import type { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import { normalizeEmail } from "@/lib/email";
import { prisma } from "@/server/db";
import { WEBAUTHN_CONFIG, attachChallengeCookie } from "../index";
import type { WebAuthnHandlerDeps } from "./types";
import { createHmac } from "crypto";

// A stable, unguessable dummy credential id for emails with no (or no
// registered) user, so the pre-auth options response is indistinguishable from
// a real account's and doesn't leak whether the email exists. The subsequent
// assertion fails anyway — this only equalises the enumerable response.
function dummyCredentialId(email: string): string {
  const secret = process.env.AUTH_SECRET ?? "webauthn-enum-guard";
  return createHmac("sha256", secret).update(normalizeEmail(email)).digest("base64url");
}

const bodySchema = z.object({
  email: z.string().email().optional(),
});

// loginOptions is a public (pre-auth) endpoint — no session required.
export function makeLoginOptionsHandler(
  deps: Pick<WebAuthnHandlerDeps, "handleApiError" | "ApiResponse">,
) {
  return async function loginOptionsHandler(
    request: NextRequest,
  ): Promise<NextResponse> {
    try {
      const json = await request.json().catch(() => ({}));
      const { email } = bodySchema.parse(json);

      let allowCredentials: { id: string; transports?: AuthenticatorTransport[] }[] = [];
      let userId: string | undefined;

      if (email) {
        // Normalised, like every other lookup: users are stored lowercase.
        const normalized = normalizeEmail(email);
        const user = await prisma.user.findUnique({
          where: { email: normalized },
          select: {
            id: true,
            webauthnCredentials: { select: { credentialId: true, transports: true } },
          },
        });
        if (user) {
          userId = user.id;
          allowCredentials = user.webauthnCredentials.map((c) => ({
            id: c.credentialId,
            transports: c.transports as AuthenticatorTransport[],
          }));
        }
        // Unknown email (or a user with no credentials): return a deterministic
        // dummy so the response doesn't reveal that the account doesn't exist.
        if (allowCredentials.length === 0) {
          allowCredentials = [{ id: dummyCredentialId(normalized) }];
        }
      }

      const options = await generateAuthenticationOptions({
        rpID: WEBAUTHN_CONFIG.rpID,
        allowCredentials,
        userVerification: "required",
      });

      const response = deps.ApiResponse.success(options);
      await attachChallengeCookie(response, options.challenge, "login", userId);
      return response;
    } catch (error) {
      return deps.handleApiError(error, "POST /api/auth/webauthn/options");
    }
  };
}
