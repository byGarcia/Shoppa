import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/server/db";
import { processProductHtml } from "@/lib/price-service";
import { requireApiKey } from "@/lib/api-key";
import { apiText } from "@/lib/api-messages";
import { priceFetchMode } from "@/lib/env";

/**
 * POST /api/prices/ingest?id=<id>[&finalUrl=<url>] — an assisted-mode fetcher
 * posts a product page it downloaded from inside its own network; the body is
 * the raw HTML. On a fetch failure it posts `?id=<id>&error=<msg>` with an
 * empty body.
 *
 * The app does all the price logic (extract → sanity guard → alert → Telegram)
 * via processProductHtml, so it stays the single source of truth regardless of
 * who fetched the page. API-key auth (`N8N_API_KEY`).
 *
 * Product pages run to a few MB; opt out of static optimization and take the
 * full request window.
 *
 * `PRICE_FETCH_MODE=assisted` only; 410 in the default `local` mode.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: NextRequest): Promise<NextResponse> {
  // `local` mode means this instance reads the shops itself: there is no
  // external fetcher to serve, and an endpoint that answers 200 with an empty
  // list would let someone build a fetcher against it and never find out why it
  // never gets work. 410 says the door existed and is closed, and names the way
  // to open it.
  if (priceFetchMode() === "local") {
    return NextResponse.json({ error: await apiText("prices.localMode") }, { status: 410 });
  }

  const denied = await requireApiKey(request);
  if (denied) return denied;

  const id = request.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: await apiText("prices.missingId") }, { status: 400 });

  const product = await prisma.trackedProduct.findUnique({ where: { id } });
  if (!product) return NextResponse.json({ error: await apiText("prices.productNotFound") }, { status: 404 });

  try {
    // The alert is DECIDED here and DELIVERED by the caller. A fetcher running
    // inside the operator's own network can hold the bot token there, so
    // deferring the send means it never has to be copied onto the server. Same
    // split as the fetching: the app owns the logic, the fetcher does the
    // legwork. An operator who would rather the server sent the message sets
    // TELEGRAM_* here and uses the built-in schedule instead.
    const notify = { deferNotify: true };

    const error = request.nextUrl.searchParams.get("error");
    if (error) {
      const outcome = await processProductHtml(product, { error }, notify);
      return NextResponse.json({ outcome });
    }

    const html = await request.text();
    if (html.length === 0) {
      const outcome = await processProductHtml(product, { error: await apiText("prices.emptyDownload") }, notify);
      return NextResponse.json({ outcome });
    }

    const finalUrl = request.nextUrl.searchParams.get("finalUrl") ?? undefined;
    const outcome = await processProductHtml(product, { html, finalUrl }, notify);
    return NextResponse.json({ outcome });
  } catch (err) {
    console.error("[prices/ingest] error:", err);
    return NextResponse.json({ error: await apiText("internal") }, { status: 500 });
  }
}
