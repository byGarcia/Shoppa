import { NextRequest, NextResponse } from "next/server";
import { completeFetch, listPendingJobs } from "@/lib/fetch-jobs";
import { requireApiKey } from "@/lib/api-key";
import { apiText } from "@/lib/api-messages";
import { priceFetchMode } from "@/lib/env";

/**
 * The assisted-mode fetcher's mailbox.
 *
 * GET  → `{ jobs: [{id, url}] }`, the pages this host could not download itself
 *        (bot-walled from a datacenter address). The fetcher polls this every
 *        few seconds from inside its own network.
 * POST ?id=<id> → body = the raw HTML it downloaded (or `?error=<msg>`), which
 *        unblocks whoever is awaiting that job inside fetchProductHtml.
 *
 * Outbound-only by design: the fetcher calls us, we never call the fetcher, so
 * there is no inbound surface and no tunnel to secure. API-key auth.
 *
 * `PRICE_FETCH_MODE=assisted` only; 410 in the default `local` mode, where
 * fetchAtHome never enqueues anything and this mailbox is always empty.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 30;

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
  return NextResponse.json({ jobs: listPendingJobs() });
}

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

  const error = request.nextUrl.searchParams.get("error");
  if (error) {
    return NextResponse.json({ accepted: completeFetch(id, { error }) });
  }

  const html = await request.text();
  if (html.length === 0) {
    return NextResponse.json({ accepted: completeFetch(id, { error: await apiText("prices.emptyDownload") }) });
  }
  return NextResponse.json({ accepted: completeFetch(id, { html }) });
}
