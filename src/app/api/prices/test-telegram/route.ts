import { withAuth, ApiResponse } from "@/lib/api-utils";
import { isTelegramConfigured, sendTelegram } from "@/lib/telegram";
import { apiText } from "@/lib/api-messages";

/**
 * POST /api/prices/test-telegram — the button in /ajustes/telegram.
 *
 * These apps do not run locally (no database), so this is the only honest way
 * to verify the notification channel without waiting for a price to drop.
 */
export const POST = withAuth(async () => {
  if (!isTelegramConfigured()) {
    return ApiResponse.badRequest(
      await apiText("prices.telegramMissingConfig"),
    );
  }

  const result = await sendTelegram(
    await apiText("prices.telegramTest"),
  );
  if (!result.ok) return ApiResponse.badRequest(await apiText("prices.telegramRejected", { reason: result.reason }));

  return ApiResponse.success({ sent: true });
});
