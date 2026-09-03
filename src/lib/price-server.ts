/**
 * DB-touching helpers for price tracking, kept out of the routes so the app
 * form and the Siri "share" shortcut create products through the same path
 * (mirrors what grocery-server.ts does for items).
 */

import { prisma, type TrackedProduct } from "@/server/db";
import { extractPriceCandidates, normalizeProductUrl } from "./price-extract";
import { assertPublicUrl, fetchProductHtml } from "./price-fetch";
import type { PriceOption, TrackedProductDTO } from "@/types";
import { apiText } from "@/lib/api-messages";

export type PreviewResult = {
  url: string;
  domain: string;
  title: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string;
  /** Every distinct price detected, so the user can pick the right one. */
  options: PriceOption[];
  /** Why the price is missing, when it is. Shown so the user knows what happened. */
  error: string | null;
  /** Already tracked: the UI offers to open it instead of creating a duplicate. */
  existingId: string | null;
};

/**
 * Collapse the raw candidate list into what the UI shows: one entry per
 * (price, source), highest-priority source first, so "39,90 € en JSON-LD" and
 * the same number echoed in Open Graph don't appear twice.
 */
function toOptions(
  candidates: ReturnType<typeof extractPriceCandidates>["candidates"],
): PriceOption[] {
  const seen = new Set<string>();
  const options: PriceOption[] = [];
  for (const c of candidates) {
    const key = `${c.source}:${c.price}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({ price: c.price, currency: c.currency ?? "EUR", source: c.source });
  }
  return options;
}

export function toProductDTO(product: TrackedProduct): TrackedProductDTO {
  return {
    id: product.id,
    url: product.url,
    domain: product.domain,
    title: product.title,
    imageUrl: product.imageUrl,
    basePrice: Number(product.basePrice),
    currency: product.currency,
    currentPrice: product.currentPrice === null ? null : Number(product.currentPrice),
    lowestPrice: product.lowestPrice === null ? null : Number(product.lowestPrice),
    lowestAt: product.lowestAt?.toISOString() ?? null,
    alertActive: product.alertActive,
    isActive: product.isActive,
    lastCheckedAt: product.lastCheckedAt?.toISOString() ?? null,
    failCount: product.failCount,
    lastError: product.lastError,
    priceHintSource: product.priceHintSource,
    createdAt: product.createdAt.toISOString(),
  };
}

/**
 * Read a pasted URL without writing anything: the "is this the right product
 * and the right price?" step of the add form.
 */
export async function previewProduct(rawUrl: string): Promise<PreviewResult | null> {
  const normalized = normalizeProductUrl(rawUrl);
  if (!normalized) return null;

  const existing = await prisma.trackedProduct.findUnique({
    where: { url: normalized.url },
    select: { id: true },
  });

  // "Usable" = it actually contains a price. Otherwise the read is retried from
  // home, because a shop that stonewalls this host often serves a complete-
  // looking page with the price stripped out.
  const fetched = await fetchProductHtml(normalized.url, {
    isUsable: (html) => extractPriceCandidates(html, normalized.url).candidates.length > 0,
  });
  if (!fetched.ok) {
    return {
      url: normalized.url,
      domain: normalized.domain,
      title: null,
      imageUrl: null,
      price: null,
      currency: "EUR",
      options: [],
      error: fetched.message,
      existingId: existing?.id ?? null,
    };
  }

  const { candidates, title, imageUrl } = extractPriceCandidates(fetched.html, normalized.url);
  const options = toOptions(candidates);
  const primary = candidates[0] ?? null;
  return {
    url: normalized.url,
    domain: normalized.domain,
    title: primary?.title ?? title,
    imageUrl: primary?.imageUrl ?? imageUrl,
    price: primary?.price ?? null,
    currency: primary?.currency ?? "EUR",
    options,
    error: primary ? null : await apiText("prices.noPriceFound"),
    existingId: existing?.id ?? null,
  };
}

export type CreateInput = {
  url: string;
  basePrice: number;
  title: string;
  imageUrl?: string | null;
  currency?: string;
  /** Detected source the reference price came from; null = generic re-guess. */
  hintSource?: string | null;
};

export type CreateResult =
  | { ok: true; product: TrackedProduct; reused: boolean }
  | { ok: false; reason: string };

/**
 * Create a watch. The first reading is the reference price, so `currentPrice`
 * starts equal to `basePrice` and `alertActive` starts false — a product added
 * today cannot be "below its own reference".
 *
 * Rejects non-public URLs up front: in `assisted` mode the daily fetch runs
 * from inside the operator's own network, so a stored private URL would be an
 * SSRF against whatever lives there.
 */
export async function createTrackedProduct(input: CreateInput): Promise<CreateResult> {
  const normalized = normalizeProductUrl(input.url);
  if (!normalized) return { ok: false, reason: await apiText("prices.invalidUrl") };

  const blocked = await assertPublicUrl(normalized.url);
  if (blocked) return { ok: false, reason: blocked };

  const existing = await prisma.trackedProduct.findUnique({ where: { url: normalized.url } });
  if (existing) return { ok: true, product: existing, reused: true };

  const now = new Date();
  const product = await prisma.trackedProduct.create({
    data: {
      url: normalized.url,
      domain: normalized.domain,
      title: input.title.slice(0, 200),
      imageUrl: input.imageUrl ?? null,
      basePrice: input.basePrice,
      currency: input.currency ?? "EUR",
      currentPrice: input.basePrice,
      lowestPrice: input.basePrice,
      lowestAt: now,
      lastCheckedAt: now,
      priceHintSource: input.hintSource ?? null,
    },
  });
  await prisma.priceCheck.create({ data: { productId: product.id, price: input.basePrice } });

  return { ok: true, product, reused: false };
}
