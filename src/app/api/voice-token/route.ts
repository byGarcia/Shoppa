import { withAuth, withAuthRequest, ApiResponse, validateRequest } from "@/lib/api-utils";
import { prisma } from "@/server/db";
import { voiceTokenCreateSchema } from "@/lib/validations";
import { generateVoiceToken, hashVoiceToken } from "@/lib/voice-token";

// Voice tokens ARE per-user: the only user-scoped rows in the product.
// Everything else on a Shoppa instance belongs to the household.
export const GET = withAuth(async (session) => {
  const tokens = await prisma.voiceToken.findMany({
    where: { userId: session.user.id },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
    orderBy: { createdAt: "desc" },
  });
  return ApiResponse.success({ tokens });
});

export const POST = withAuthRequest(async (request, session) => {
  const validation = await validateRequest(request, voiceTokenCreateSchema);
  if (!validation.success) return validation.response;

  // Plaintext exists ONLY in this response — the DB stores the SHA-256.
  const token = generateVoiceToken();
  const voiceToken = await prisma.voiceToken.create({
    data: {
      userId: session.user.id,
      tokenHash: hashVoiceToken(token),
      label: validation.data.label,
    },
    select: { id: true, label: true, createdAt: true, lastUsedAt: true },
  });
  return ApiResponse.created({ token, voiceToken });
});
