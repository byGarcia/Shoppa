import { NextResponse } from "next/server";
import { getTranslations } from "next-intl/server";
import { ingestSchema } from "@/lib/validations";
import { authenticateVoiceToken } from "@/lib/voice-token";
import { normalizeGroceryText, tokenMatches } from "@/lib/grocery-match";
import { prisma } from "@/server/db";

/**
 * POST /api/ingest/remove — the "remove from the shopping list" Siri Shortcut.
 * Marks as CHECKED (recoverable, never deletes) the most recent unchecked item matching by normalizedName across
 * ALL stores + inbox. Exact match first, then whole-name fuzzy fallback.
 * Explicit "not found" reply on a miss (`ingest.notFound`) so a dictation variant is never silent.
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
    const parsed = ingestSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, message: t("ingest.missingText") }, { status: 400 });
    }

    const normalized = normalizeGroceryText(parsed.data.text);

    let target = await prisma.groceryItem.findFirst({
      where: { normalizedName: normalized, checked: false },
      orderBy: { createdAt: "desc" },
    });

    if (!target) {
      // Fuzzy fallback: every token of the dictated text must closely match a
      // token of the candidate's normalizedName ("yogures" → "yogur griego").
      const unchecked = await prisma.groceryItem.findMany({
        where: { checked: false },
        orderBy: { createdAt: "desc" },
      });
      const wanted = normalized.split(" ").filter(Boolean);
      target =
        unchecked.find((item) => {
          const have = item.normalizedName.split(" ");
          return wanted.every((w) => have.some((h) => tokenMatches(w, h)));
        }) ?? null;
    }

    if (!target) {
      // 200 (not 404) so the Shortcut's "Show Result" displays the message
      // instead of failing opaquely. Every ingest answer is a 200 with an
      // `ok` flag and a `message` the Shortcut can speak.
      return NextResponse.json({ ok: false, message: t("ingest.notFound", { text: parsed.data.text }) });
    }

    await prisma.groceryItem.update({
      where: { id: target.id },
      data: { checked: true, checkedAt: new Date() },
    });

    return NextResponse.json({ ok: true, message: t("ingest.removed", { names: target.name }) });
  } catch (error) {
    console.error("[ingest/remove] error:", error);
    return NextResponse.json({ ok: false, message: t("internal") }, { status: 500 });
  }
}
