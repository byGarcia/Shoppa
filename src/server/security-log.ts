import "server-only";

import { prisma } from "./db";

/**
 * Best-effort write to `security_logs`.
 *
 * Best effort because an audit trail that can fail a request turns a logging
 * outage into an outage. It is still worth having: registering a passkey
 * destroys the account's password and nothing in this release can undo that,
 * so the one durable record that it happened is this row.
 *
 * src/lib/auth.ts keeps its own private `logAuthEvent` for sign-in events;
 * folding the two together is a tidy-up for the packaging task, not for this
 * one.
 */
export async function recordSecurityEvent(input: {
  eventType: "PASSKEY_REGISTERED" | "PASSKEY_DELETED";
  userId?: string | null;
  email?: string | null;
  success?: boolean;
  endpoint?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: Record<string, unknown>;
}): Promise<void> {
  try {
    await prisma.securityLog.create({
      data: {
        eventType: input.eventType,
        severity: "INFO",
        userId: input.userId ?? null,
        email: input.email ?? null,
        success: input.success ?? true,
        endpoint: input.endpoint ?? null,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent?.slice(0, 240) ?? null,
        details: input.details ? JSON.stringify(input.details) : null,
      },
    });
  } catch (error) {
    console.error("Could not record the security event:", error);
  }
}
