import { createHash, randomBytes } from "crypto";
import { prisma } from "@/server/db";

/** 32 bytes of entropy, base64url. Shown once, never stored. */
export function generateVoiceToken(): string {
  return randomBytes(32).toString("base64url");
}

/** SHA-256 hex. Only the hash hits the DB, so a leak exposes no live creds;
 * deterministic hashing also makes the unique-index lookup timing-irrelevant. */
export function hashVoiceToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Authenticate a Siri Shortcut request: parse `Authorization: Bearer <token>`,
 * hash it, look up by tokenHash. Returns null on any failure (route replies 401).
 * Bumps lastUsedAt fire-and-forget.
 */
export async function authenticateVoiceToken(
  request: Request,
): Promise<{ userId: string; tokenId: string } | null> {
  const header = request.headers.get("authorization");
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;
  if (!token) return null;

  const row = await prisma.voiceToken.findUnique({
    where: { tokenHash: hashVoiceToken(token) },
    select: { id: true, userId: true },
  });
  if (!row) return null;

  void prisma.voiceToken
    .update({ where: { id: row.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  return { userId: row.userId, tokenId: row.id };
}
