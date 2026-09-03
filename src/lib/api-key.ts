import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { apiText } from "@/lib/api-messages";

/**
 * Machine-to-machine auth for the price endpoints an external fetcher calls in
 * `PRICE_FETCH_MODE=assisted`, and for the manual `POST /api/prices/check`:
 * `Authorization: Bearer $N8N_API_KEY`, compared in constant time. Returns an
 * error response to send back, or null when the key is valid.
 *
 * The variable is named after a workflow runner that no longer has anything to
 * do with it. Renaming it would break every existing deployment's environment
 * for a cosmetic gain, so it stays and docs/price-tracking.md says what it is.
 */
export async function requireApiKey(request: NextRequest): Promise<NextResponse | null> {
  const apiKey = process.env.N8N_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "N8N_API_KEY is not set" }, { status: 500 });
  }

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return NextResponse.json({ error: await apiText("unauthorized") }, { status: 401 });
  }

  const provided = header.substring(7);
  if (
    provided.length !== apiKey.length ||
    !timingSafeEqual(Buffer.from(provided), Buffer.from(apiKey))
  ) {
    return NextResponse.json({ error: await apiText("badApiKey") }, { status: 401 });
  }

  return null;
}
