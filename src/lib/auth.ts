import NextAuth from "next-auth";
import type { Session } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { prisma } from "@/server/db";
import { authMode, isSecureOrigin, trustedProxy } from "@/lib/env";
import { authorizePassword } from "@/lib/auth-password";
import { sessionCookieName } from "@/lib/transport";
import { verifyWebAuthnAssertion, clientIPFromHeaders as baseClientIPFromHeaders } from "@/server/webauthn";

function safeUA(raw: string | null | undefined): string {
  const trimmed = (raw ?? "").slice(0, 240);
  return trimmed ? `Shoppa ${trimmed}` : "Shoppa";
}

async function logAuthEvent(
  eventType: "LOGIN_SUCCESS" | "LOGIN_FAILED" | "LOGOUT",
  email: string | null,
  userId: string | null = null,
  details: Record<string, unknown> = {},
  userAgent: string | null | undefined = null,
  ipAddress: string | null = null,
): Promise<void> {
  try {
    await prisma.securityLog.create({
      data: {
        eventType,
        severity: eventType === "LOGIN_FAILED" ? "WARNING" : "INFO",
        email,
        userId,
        success: eventType === "LOGIN_SUCCESS",
        details: Object.keys(details).length > 0 ? JSON.stringify(details) : null,
        userAgent: safeUA(userAgent),
        ipAddress,
      },
    });
  } catch (error) {
    console.error("Failed to log auth event:", error);
  }
}

// The config is a function, not a literal: cookie name and `secure` come from
// APP_ORIGIN, and NextAuth resolves this per request. Building the object at
// module load would read the environment while `next build` collects page data,
// where none of these variables exist, and the build would die.
export const { handlers, signIn, signOut, auth } = NextAuth(() => ({
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  pages: {
    signIn: "/login",
  },
  // The session cookie is host-only and named by transport (sessionCookieName()
  // picks the `__Secure-` prefix only on an https origin, because a browser
  // refuses that prefix over plain HTTP and a LAN instance would lose its
  // session). It is never widened to a parent domain: WEBAUTHN_RP_ID can be a
  // parent domain, and if the session followed it every application under that
  // domain would be handed this one's cookie.
  cookies: {
    sessionToken: {
      name: sessionCookieName(),
      options: {
        httpOnly: true,
        sameSite: "lax",
        path: "/",
        secure: isSecureOrigin(),
      },
    },
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        webauthnAssertion: { label: "WebAuthn", type: "text" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        const email = credentials?.email as string | undefined;
        const assertionRaw = credentials?.webauthnAssertion as string | undefined;
        const password = credentials?.password as string | undefined;
        const ua =
          request instanceof Request
            ? request.headers.get("user-agent")
            : null;
        const ip =
          request instanceof Request
            ? baseClientIPFromHeaders(request.headers, { trustedProxy: trustedProxy() })
            : null;

        if (!email) return null;

        // The password branch comes first because it is the one the caller
        // asked for by sending a password at all. It is the branch that makes
        // the app usable on a LAN address, where a passkey cannot be created.
        if (password) {
          const result = await authorizePassword(email, password);
          if (!result.ok) {
            await logAuthEvent("LOGIN_FAILED", email, null, {
              method: "password",
              reason: result.reason,
            }, ua, ip);
            return null;
          }
          await logAuthEvent("LOGIN_SUCCESS", email, result.user.id, { method: "password" }, ua, ip);
          return { ...result.user };
        }

        // The passkey ceremony is deliberately NOT gated on the failed-password
        // counter: a household frozen out of passwords has to keep a way in.
        if (authMode() === "password") {
          await logAuthEvent("LOGIN_FAILED", email, null, {
            method: "webauthn",
            reason: "disabled",
          }, ua, ip);
          return null;
        }
        if (!assertionRaw) return null;

        const result = await verifyWebAuthnAssertion(email, assertionRaw);
        if (!result.ok) {
          await logAuthEvent("LOGIN_FAILED", email, result.userId ?? null, {
            reason: result.reason,
            ...(result.details ?? {}),
          }, ua, ip);
          return null;
        }
        await logAuthEvent("LOGIN_SUCCESS", email, result.user.id, { method: "webauthn" }, ua, ip);
        return {
          id: result.user.id,
          email: result.user.email,
          name: result.user.name ?? null,
          tokenVersion: result.user.tokenVersion,
        };
      },
    }),
  ],
  events: {
    async signOut(message) {
      const userId =
        message && "token" in message && message.token
          ? (message.token.id as string | undefined)
          : undefined;
      const email =
        message && "token" in message && message.token
          ? (message.token.email as string | null | undefined)
          : null;
      if (userId) {
        await logAuthEvent("LOGOUT", email ?? null, userId);
      }
    },
  },
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = (user as { id: string }).id;
        token.tokenVersion = (user as { tokenVersion?: number }).tokenVersion ?? 0;
      }
      return token;
    },
    async session({ session, token }) {
      if (!session.user || !token.id) return session;
      // "Sign out everywhere" bumps tokenVersion; a stale JWT must not pass.
      const fresh = await prisma.user.findUnique({
        where: { id: token.id as string },
        select: { tokenVersion: true },
      });
      if (!fresh || fresh.tokenVersion !== (token.tokenVersion ?? 0)) {
        return null as unknown as Session;
      }
      (session.user as { id?: string }).id = token.id as string;
      return session;
    },
  },
}));
