import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { ingestSchema } from "@/lib/validations";
import { categoryDisplayName } from "@/lib/category-name";
import { authenticateVoiceToken } from "@/lib/voice-token";
import { addOrReviveItem } from "@/lib/grocery-server";
import { prisma } from "@/server/db";

/**
 * POST /api/ingest/voice — the "add to the shopping list" Siri Shortcut.
 * Body { text }, Authorization: Bearer <VoiceToken>.
 * Creates/revives the item in the shop it was last filed under, or in the
 * inbox when it has never been filed; auto-categorized either way.
 * Response body.message is what the Shortcut shows/speaks.
 */
export async function POST(request: Request): Promise<NextResponse> {
  // Siri reads `message` out loud, so it is copy like anything on a screen.
  // Shortcuts send no cookie, so this falls back to Accept-Language and then
  // to Spanish — which is what the household hears today.
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
    const parsed = ingestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: t("ingest.missingText") }, { status: 400 });
    }

    const { item } = await addOrReviveItem({
      name: parsed.data.text,
      storeId: null, // the learned shop, else the inbox ("unassigned" tab)
      source: "SIRI",
      addedByUserId: auth.userId,
    });

    // The shop is what the person needs to hear: it is where they will look.
    if (item.storeId) {
      const store = await prisma.groceryStore.findUnique({
        where: { id: item.storeId },
        select: { name: true },
      });
      if (store) {
        return NextResponse.json({
          ok: true,
          message: t("ingest.addedToStore", { name: item.name, store: store.name }),
        });
      }
    }

    const tCategories = await getTranslations("categories");
    const category = item.categoryId
      ? await prisma.groceryCategory.findUnique({
          where: { id: item.categoryId },
          select: { name: true, nameKey: true },
        })
      : null;

    return NextResponse.json({
      ok: true,
      message: category
        ? t("ingest.addedWithCategory", {
            name: item.name,
            category: categoryDisplayName(category, (key) =>
              tCategories.has(key) ? tCategories(key) : category.name,
            ),
          })
        : t("ingest.added", { name: item.name }),
    });
  } catch (error) {
    console.error("[ingest/voice] error:", error);
    return NextResponse.json({ ok: false, message: t("internal") }, { status: 500 });
  }
}
