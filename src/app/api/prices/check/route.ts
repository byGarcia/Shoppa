import { NextRequest, NextResponse } from "next/server";
import { runPriceCheck } from "@/lib/price-service";
import { requireApiKey } from "@/lib/api-key";
import { apiText } from "@/lib/api-messages";

/**
 * POST /api/prices/check — runs a whole pass on this host, fetching locally.
 * The daily run is scheduled inside the application (src/lib/scheduler.ts), so
 * this is the manual, debugging and external-scheduler way in; it is also the
 * only price endpoint that stays open in `local` mode.
 *
 * Idempotency lives per product in `lastCheckedAt`, not in a per-run row: this
 * endpoint can be re-fired the same day and it will only retry what failed,
 * without re-notifying anything. `?force=1` ignores that guard for debugging.
 *
 * Long-running by design (it downloads product pages), so it opts out of any
 * static optimization and gets the platform's full request window.
 */
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const denied = await requireApiKey(request);
  if (denied) return denied;

  try {
    const force = request.nextUrl.searchParams.get("force") === "1";
    const summary = await runPriceCheck({ force });
    return NextResponse.json(summary);
  } catch (error) {
    console.error("[prices/check] the daily pass failed:", error);
    return NextResponse.json({ error: await apiText("internal") }, { status: 500 });
  }
}
