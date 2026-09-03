import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { priceUrlSchema } from "@/lib/validations";
import { authenticateVoiceToken } from "@/lib/voice-token";
import { createTrackedProduct, previewProduct } from "@/lib/price-server";

/**
 * POST /api/ingest/track — iOS "Compartir → vigilar precio" shortcut.
 * Body { url }, Authorization: Bearer <VoiceToken> (the same token the voice
 * shortcut uses).
 *
 * There is no confirmation step here, so the reference price has to come from
 * the page itself: if the shop blocks the read there is nothing to compare
 * against later, and the shortcut says so instead of creating a broken watch.
 * `body.message` is what the Shortcut shows.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // What the Shortcut shows; see the voice route for why there is no cookie.
  const t = await getTranslations("api");
  try {
    const auth = await authenticateVoiceToken(request);
    if (!auth) {
      return NextResponse.json({ ok: false, message: t("unauthorized") }, { status: 401 });
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, message: t("invalidJson") }, { status: 400 });
    }
    const parsed = priceUrlSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: t("ingest.missingUrl") }, { status: 400 });
    }

    const preview = await previewProduct(parsed.data.url);
    if (!preview) {
      return NextResponse.json({ ok: false, message: t("ingest.invalidUrl") }, { status: 400 });
    }
    if (preview.existingId) {
      return NextResponse.json({ ok: true, message: t("ingest.alreadyTracking") });
    }
    if (preview.price === null) {
      return NextResponse.json(
        {
          ok: false,
          message: t("ingest.readFailed", {
            reason: preview.error ?? t("ingest.unreadablePage"),
          }),
        },
        { status: 422 },
      );
    }

    const result = await createTrackedProduct({
      url: preview.url,
      basePrice: preview.price,
      title: preview.title ?? preview.domain,
      imageUrl: preview.imageUrl,
      currency: preview.currency,
      // No confirmation step here: the reference is the primary detected price,
      // so its source is the hint the cron will return to.
      hintSource: preview.options[0]?.source ?? null,
    });
    if (!result.ok) {
      return NextResponse.json({ ok: false, message: result.reason }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      message: t("ingest.tracking", {
        name: result.product.title,
        price: `${preview.price} ${preview.currency}`,
      }),
    });
  } catch (error) {
    console.error("[ingest/track] error:", error);
    return NextResponse.json({ ok: false, message: t("internal") }, { status: 500 });
  }
}
