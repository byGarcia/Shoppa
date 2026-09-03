/**
 * Telegram bot notifications for the price watcher.
 *
 * Config comes from the environment: TELEGRAM_BOT_TOKEN (or TELEGRAM_TOKEN) and
 * TELEGRAM_CHAT_ID. Never from the repository.
 *
 * The TELEGRAM_TOKEN alias is deliberate. People reuse a bot whose token is
 * already stored somewhere under that name, and copying the name along with the
 * value is the obvious mistake to make. Without the alias the failure is silent
 * — a no-op plus one log line nobody reads.
 *
 * Missing config is a no-op with a single warning, never a throw. A missing
 * token must not take the daily price run down with it.
 */

import { apiText } from "@/lib/api-messages";

const API_TIMEOUT_MS = 8_000;

let missingConfigWarned = false;

function botToken(): string | undefined {
  return process.env.TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_TOKEN;
}

export type TelegramResult = { ok: true } | { ok: false; reason: string };

/** Telegram's HTML parse mode only needs these three escaped. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function isTelegramConfigured(): boolean {
  return Boolean(botToken() && process.env.TELEGRAM_CHAT_ID);
}

/**
 * Send a message to the household chat. The caller passes text already escaped
 * except for the anchor/bold tags it wants Telegram to render.
 */
export async function sendTelegram(text: string): Promise<TelegramResult> {
  const token = botToken();
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    if (!missingConfigWarned) {
      missingConfigWarned = true;
      console.warn(
        "[telegram] TELEGRAM_BOT_TOKEN (or TELEGRAM_TOKEN) / TELEGRAM_CHAT_ID missing: no alerts are sent",
      );
    }
    return { ok: false, reason: await apiText("fetch.telegramNotConfigured") };
  }

  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        // The product link is the point of the message; keep its preview.
        disable_web_page_preview: false,
      }),
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    if (!response.ok) {
      // Telegram puts the real cause in `description` (bad chat_id, revoked
      // token). Surfacing it is what makes the test button in /ajustes/telegram
      // useful instead of a generic red toast.
      let description = `HTTP ${response.status}`;
      try {
        const body = (await response.json()) as { description?: string };
        if (body?.description) description = body.description;
      } catch {
        // Non-JSON error body: keep the status.
      }
      console.error("[telegram] send failed:", description);
      return { ok: false, reason: description };
    }

    return { ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : await apiText("fetch.networkError");
    console.error("[telegram] send failed:", message);
    return { ok: false, reason: message };
  }
}
