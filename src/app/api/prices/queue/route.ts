import { NextRequest, NextResponse } from "next/server";
import { listDueProducts } from "@/lib/price-service";
import { requireApiKey } from "@/lib/api-key";
import { apiText } from "@/lib/api-messages";
import { priceFetchMode } from "@/lib/env";

/**
 * GET /api/prices/queue — the work list an assisted-mode fetcher pulls each
 * morning: active products not yet checked today, `{ products: [{ id, url }] }`.
 *
 * The fetcher downloads each URL from inside its own network and POSTs the HTML
 * back to `/api/prices/ingest`. API-key auth (`N8N_API_KEY`), same as the other
 * machine-to-machine price routes.
 *
 * `PRICE_FETCH_MODE=assisted` only; 410 in the default `local` mode.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
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

  try {
    const products = await listDueProducts();
    return NextResponse.json({ products });
  } catch (error) {
    console.error("[prices/queue] error:", error);
    return NextResponse.json({ error: await apiText("internal") }, { status: 500 });
  }
}
