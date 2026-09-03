/**
 * Pure product-page parsing. No network, no DB — everything here is a function
 * of (html, url), which is what makes it the only part of the price-tracking
 * feature that can be tested without internet.
 *
 * Extraction order, first hit wins: JSON-LD -> microdata -> Open Graph ->
 * per-domain adapter. Most Spanish shops ship a JSON-LD Product block, which
 * also hands us the title and image for free.
 */

export type ExtractionSource = "json-ld" | "microdata" | "open-graph" | "domain";

export type ExtractedProduct = {
  price: number | null;
  currency: string | null;
  title: string | null;
  imageUrl: string | null;
  /** Which strategy produced the price. Null when no price was found. */
  source: ExtractionSource | null;
};

const EMPTY: ExtractedProduct = {
  price: null,
  currency: null,
  title: null,
  imageUrl: null,
  source: null,
};

// ============================================================================
// URL NORMALIZATION
// ============================================================================

/**
 * Tracking/session params. Stripping them is what makes `TrackedProduct.url`
 * unique in practice: the same product shared from the app, from search and
 * from a mail all arrive with different tails.
 */
const TRACKING_PARAMS = [
  "tag",
  "ref",
  "ref_",
  "psc",
  "th",
  "smid",
  "linkCode",
  "linkId",
  "creative",
  "creativeASIN",
  "camp",
  "ascsubtag",
  "gclid",
  "fbclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  // Awin/affiliate tails (MyProtein and the rest of THG). Same product, same
  // page: keeping them would split the unique index and duplicate the watch.
  "affil",
  "awc",
  "_encoding",
  "qid",
  "sr",
  "sprefix",
  "crid",
  "keywords",
  "pd_rd_r",
  "pd_rd_w",
  "pd_rd_wg",
  "pf_rd_p",
  "pf_rd_r",
  "content-id",
];

const AMAZON_ASIN = /\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:[/?]|$)/i;

/**
 * Canonicalize a pasted product URL. Returns null if it isn't a usable http(s)
 * URL. Amazon collapses to `https://<host>/dp/<ASIN>`, which is the only stable
 * identity Amazon offers — its share links carry the whole search context.
 */
export function normalizeProductUrl(raw: string): { url: string; domain: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;

  const domain = parsed.hostname.replace(/^www\./i, "").toLowerCase();

  if (domain.startsWith("amazon.") || domain.endsWith(".amazon.com")) {
    const asin = parsed.pathname.match(AMAZON_ASIN)?.[1];
    if (asin) {
      return { url: `https://${parsed.hostname}/dp/${asin.toUpperCase()}`, domain };
    }
  }

  for (const param of TRACKING_PARAMS) parsed.searchParams.delete(param);
  for (const key of [...parsed.searchParams.keys()]) {
    if (key.toLowerCase().startsWith("utm_")) parsed.searchParams.delete(key);
  }
  parsed.hash = "";
  // Trailing slash is cosmetic but would split the unique index in two.
  if (parsed.pathname.length > 1 && parsed.pathname.endsWith("/")) {
    parsed.pathname = parsed.pathname.slice(0, -1);
  }

  return { url: parsed.toString(), domain };
}

// ============================================================================
// PRICE STRING PARSING
// ============================================================================

/**
 * Parse a human price into a number. This is the single most dangerous
 * function of the feature: reading `1.299,00 €` as 1.299 would fire a "price
 * dropped!" alert on a product that did not move at all.
 *
 * Rule: when both separators appear, the LAST one is the decimal separator.
 * When only one appears, it is a thousands separator if exactly 3 digits
 * follow it (`1.299`, `1,299`), and a decimal separator otherwise (`19.99`,
 * `239,00`). Prices with 3 decimals are rare enough that this trade is right.
 */
export function parsePriceString(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;

  const cleaned = raw
    .replace(/ /g, " ")
    .replace(/[^\d.,-]/g, "")
    .trim();
  if (cleaned.length === 0) return null;

  const lastComma = cleaned.lastIndexOf(",");
  const lastDot = cleaned.lastIndexOf(".");

  let normalized: string;
  if (lastComma !== -1 && lastDot !== -1) {
    const decimalSep = lastComma > lastDot ? "," : ".";
    const thousandsSep = decimalSep === "," ? "." : ",";
    normalized = cleaned.split(thousandsSep).join("").replace(decimalSep, ".");
  } else if (lastComma !== -1 || lastDot !== -1) {
    const sep = lastComma !== -1 ? "," : ".";
    const sepIndex = lastComma !== -1 ? lastComma : lastDot;
    const occurrences = cleaned.split(sep).length - 1;
    const digitsAfter = cleaned.length - sepIndex - 1;
    if (occurrences > 1 || digitsAfter === 3) {
      normalized = cleaned.split(sep).join("");
    } else {
      normalized = cleaned.replace(sep, ".");
    }
  } else {
    normalized = cleaned;
  }

  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : null;
}

// ============================================================================
// HTML HELPERS
// ============================================================================

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
  "&euro;": "€",
};

function decodeEntities(text: string): string {
  return text
    .replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp|euro);/g, (m) => ENTITIES[m] ?? m)
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function cleanText(text: string | null | undefined): string | null {
  if (!text) return null;
  const out = decodeEntities(text).replace(/\s+/g, " ").trim();
  return out.length > 0 ? out : null;
}

/** Read a `<meta>` content value by property or name, whichever the page used. */
function metaContent(html: string, key: string): string | null {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*>`,
    "i",
  );
  const tag = html.match(pattern)?.[0];
  if (!tag) return null;
  return cleanText(tag.match(/content=["']([^"']*)["']/i)?.[1]);
}

function absoluteUrl(candidate: string | null, base: string): string | null {
  if (!candidate) return null;
  try {
    return new URL(candidate, base).toString();
  } catch {
    return null;
  }
}

// ============================================================================
// CANDIDATES
// ============================================================================
//
// The extractor returns EVERY price it can find, not just the first. This is
// what lets the add form ask for the price you can see on the page:
// you type the price you see, the server matches it against the candidates and
// remembers WHICH SOURCE it came from, and the daily cron returns to that same
// source instead of re-guessing. On a page with an offer price and a struck-out
// RRP that disambiguation is the whole game.

export type PriceCandidate = {
  price: number;
  currency: string | null;
  title: string | null;
  imageUrl: string | null;
  source: ExtractionSource;
  /** Cosmetic disambiguator within a source (e.g. `lowPrice`, an adapter id). */
  label: string;
};

// ============================================================================
// STRATEGY 1 — JSON-LD
// ============================================================================

type JsonLdNode = Record<string, unknown>;

/** A JSON-LD node plus whether it hangs off a `ProductGroup.hasVariant`. */
type CollectedNode = { node: JsonLdNode; isVariant: boolean };

function collectJsonLdNodes(html: string): CollectedNode[] {
  const nodes: CollectedNode[] = [];
  const blocks = html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
  );

  for (const block of blocks) {
    const body = block[1];
    if (!body) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.trim());
    } catch {
      continue; // A single malformed block must not kill the other strategies.
    }
    const queue: Array<{ value: unknown; isVariant: boolean }> = [
      { value: parsed, isVariant: false },
    ];
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const { value, isVariant } = current;
      const enqueue = (list: unknown[], variant = isVariant) => {
        for (const item of list) queue.push({ value: item, isVariant: variant });
      };
      if (Array.isArray(value)) {
        enqueue(value);
      } else if (value && typeof value === "object") {
        const node = value as JsonLdNode;
        nodes.push({ node, isVariant });
        if (Array.isArray(node["@graph"])) enqueue(node["@graph"] as unknown[]);
        // A ProductGroup carries no price of its own: every price on the page
        // hangs off its variants (MyProtein/THG ships 109 of them). Without
        // descending here the page yields zero candidates and looks unreadable.
        if (Array.isArray(node.hasVariant)) enqueue(node.hasVariant as unknown[], true);
      }
    }
  }
  return nodes;
}

function isProductNode(node: JsonLdNode): boolean {
  const type = node["@type"];
  if (typeof type === "string") return type.toLowerCase().includes("product");
  if (Array.isArray(type)) {
    return type.some((t) => typeof t === "string" && t.toLowerCase().includes("product"));
  }
  return false;
}

function firstImage(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return firstImage(value[0]);
  if (value && typeof value === "object") {
    const url = (value as JsonLdNode).url;
    return typeof url === "string" ? url : null;
  }
  return null;
}

type OfferNumber = {
  price: number;
  currency: string | null;
  label: string;
  /** The offer's own `url`, when it published one. */
  offerUrl: string | null;
};

/** Every numeric offer under a Product node, each with a short label. */
function offerNumbers(offers: unknown): OfferNumber[] {
  const out: OfferNumber[] = [];
  const candidates = Array.isArray(offers) ? offers : [offers];
  for (const candidate of candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const offer = candidate as JsonLdNode;
    const currency = typeof offer.priceCurrency === "string" ? offer.priceCurrency : null;
    const offerUrl = typeof offer.url === "string" ? offer.url : null;
    for (const [key, label] of [
      ["price", "price"],
      ["lowPrice", "lowPrice"],
      ["highPrice", "highPrice"],
    ] as const) {
      const price = parsePriceString(offer[key] as string | number | null);
      if (price !== null) out.push({ price, currency, label, offerUrl });
    }
    if (offer.offers) out.push(...offerNumbers(offer.offers)); // Some shops nest one level deeper.
  }
  return out;
}

/**
 * Does this offer's own URL describe the page we asked for? A variant offer
 * publishes the URL that selects it (`…/10530943/?variation=17712277`), so the
 * offer whose parameters all appear in the requested URL is THE variant the
 * user pasted and the other 108 are noise. Extra parameters on our side
 * (affiliate tails, `variation` on a page whose offers ignore it) never
 * disqualify a match; a different `variation` value does.
 */
function offerMatchesUrl(offerUrl: string, pageUrl: string): boolean {
  let offer: URL;
  let page: URL;
  try {
    offer = new URL(offerUrl, pageUrl);
    page = new URL(pageUrl);
  } catch {
    return false;
  }
  const host = (u: URL) => u.hostname.replace(/^www\./i, "").toLowerCase();
  const path = (u: URL) => u.pathname.replace(/\/+$/, "");
  if (host(offer) !== host(page) || path(offer) !== path(page)) return false;
  for (const [key, value] of offer.searchParams) {
    if (page.searchParams.get(key) !== value) return false;
  }
  return true;
}

function jsonLdCandidates(html: string, url: string): PriceCandidate[] {
  const all: Array<{ candidate: PriceCandidate; matched: boolean }> = [];
  for (const { node, isVariant } of collectJsonLdNodes(html)) {
    if (!isProductNode(node)) continue;
    const title = cleanText(typeof node.name === "string" ? node.name : null);
    const imageUrl = firstImage(node.image);
    for (const { price, currency, label, offerUrl } of offerNumbers(node.offers)) {
      const matched = offerUrl !== null && offerMatchesUrl(offerUrl, url);
      all.push({
        matched,
        candidate: {
          price,
          currency,
          // An unchosen variant's own name is worse than no name: labelling the
          // watch "Vainilla" when the URL picked no flavour is a confident lie.
          // Leaving it null lets the page title fill in.
          title: isVariant && !matched ? null : title,
          imageUrl: isVariant && !matched ? null : imageUrl,
          source: "json-ld",
          label,
        },
      });
    }
  }
  const chosen = all.some((c) => c.matched) ? all.filter((c) => c.matched) : all;
  return chosen.map((c) => c.candidate);
}

// ============================================================================
// STRATEGY 2 — MICRODATA
// ============================================================================

function microdataCandidates(html: string): PriceCandidate[] {
  const tag = html.match(/<[^>]+itemprop=["']price["'][^>]*>/i)?.[0];
  if (!tag) return [];
  const price = parsePriceString(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? null);
  if (price === null) return [];
  const currencyTag = html.match(/<[^>]+itemprop=["']priceCurrency["'][^>]*>/i)?.[0];
  const currency = currencyTag?.match(/content=["']([^"']*)["']/i)?.[1] ?? null;
  return [{ price, currency, title: null, imageUrl: null, source: "microdata", label: "itemprop" }];
}

// ============================================================================
// STRATEGY 3 — OPEN GRAPH
// ============================================================================

function openGraphCandidates(html: string, url: string): PriceCandidate[] {
  const price = parsePriceString(
    metaContent(html, "product:price:amount") ?? metaContent(html, "og:price:amount"),
  );
  if (price === null) return [];
  return [
    {
      price,
      currency:
        metaContent(html, "product:price:currency") ?? metaContent(html, "og:price:currency"),
      title: metaContent(html, "og:title"),
      imageUrl: absoluteUrl(metaContent(html, "og:image"), url),
      source: "open-graph",
      label: "meta",
    },
  ];
}

// ============================================================================
// STRATEGY 4 — PER-DOMAIN ADAPTERS
// ============================================================================

/**
 * Last resort for shops that ship no structured data. Adding a shop = adding an
 * entry; the engine does not change. Values from here are the most likely to be
 * wrong, which is why the sanity guard in price-service.ts exists.
 */
/**
 * Every `.a-offscreen` price on an Amazon page that is NOT inside a
 * recommendation carousel.
 *
 * Amazon frequently serves automated clients a page with the buy box stripped
 * out but the "productos relacionados" carousels intact. Reading the first
 * `.a-offscreen` then yields a NEIGHBOURING product's price and stores it as
 * this product's reference — a silent, confident lie that breaks every future
 * alert. Carousel links are recognisable: their markup carries `pd_rd_i=`
 * (the recommended item's ASIN) or a sponsored marker just before the price.
 *
 * When the buy box is missing, this correctly returns nothing and the caller
 * reports "no price found", which is the honest answer.
 */
function amazonPrices(html: string): string[] {
  const CAROUSEL_MARKERS = ["pd_rd_i=", "sp_atf", "sp_csd", "_carousel", "aod-asin-image"];
  const LOOKBEHIND = 400;
  const out: string[] = [];

  for (const match of html.matchAll(
    /<span[^>]*class=["'][^"']*a-offscreen[^"']*["'][^>]*>([^<]+)<\/span>/gi,
  )) {
    const value = match[1]?.trim();
    if (!value) continue;
    const before = html.slice(Math.max(0, match.index - LOOKBEHIND), match.index);
    if (CAROUSEL_MARKERS.some((marker) => before.includes(marker))) continue;
    out.push(value);
  }
  return out;
}

const DOMAIN_ADAPTERS: Array<{
  id: string;
  match: (domain: string) => boolean;
  price: RegExp[];
  /** Adapters whose price needs more than a regex (see amazonPrices). */
  extract?: (html: string) => string[];
  title?: RegExp[];
}> = [
  {
    id: "amazon",
    match: (d) => d.startsWith("amazon.") || d.endsWith(".amazon.com") || d.startsWith("amzn."),
    // Amazon has NO JSON-LD, microdata or OG price (verified 2026-07-24 on a
    // live product page), so this adapter is the only route — which is exactly
    // why it must not guess. `extract` below filters out the recommendation
    // carousels; a plain "first .a-offscreen" once stored a neighbouring
    // product's 49,88 € as the reference for a 59,99 € item.
    price: [],
    extract: amazonPrices,
    title: [/<span[^>]*id=["']productTitle["'][^>]*>([\s\S]*?)<\/span>/i],
  },
  {
    id: "pccomponentes",
    match: (d) => d.includes("pccomponentes."),
    price: [
      /<[^>]+data-price=["']([^"']+)["']/i,
      /<[^>]+id=["']precio-main["'][^>]*>([^<]+)</i,
    ],
  },
];

function domainCandidates(html: string, domain: string): PriceCandidate[] {
  const adapter = DOMAIN_ADAPTERS.find((entry) => entry.match(domain));
  if (!adapter) return [];

  let title: string | null = null;
  for (const titlePattern of adapter.title ?? []) {
    title = cleanText(html.match(titlePattern)?.[1]);
    if (title) break;
  }

  const out: PriceCandidate[] = [];
  const push = (raw: string | null, label: string) => {
    const price = parsePriceString(raw);
    if (price === null) return;
    // Same price twice (Amazon repeats it) adds a duplicate chip, not information.
    if (out.some((c) => c.price === price)) return;
    out.push({ price, currency: null, title, imageUrl: null, source: "domain", label });
  };

  if (adapter.extract) {
    adapter.extract(html).forEach((raw, index) => push(raw, `${adapter.id}#${index}`));
  }
  adapter.price.forEach((pattern, index) => {
    push(html.match(pattern)?.[1] ?? null, `${adapter.id}re${index}`);
  });
  return out;
}

// ============================================================================
// PUBLIC ENTRY POINTS
// ============================================================================

function pageTitle(html: string): string | null {
  return (
    metaContent(html, "og:title") ??
    cleanText(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1])
  );
}

/**
 * Every price the page offers, in strategy-priority order (JSON-LD → microdata
 * → Open Graph → domain adapter), with each candidate's title/image/currency
 * gaps filled from the page. Never throws.
 */
export function extractPriceCandidates(
  html: string,
  url: string,
): { candidates: PriceCandidate[]; title: string | null; imageUrl: string | null } {
  const title = html ? pageTitle(html) : null;
  const imageUrl = html ? absoluteUrl(metaContent(html, "og:image"), url) : null;
  if (!html) return { candidates: [], title, imageUrl };

  const domain = normalizeProductUrl(url)?.domain ?? "";
  const raw = [
    ...jsonLdCandidates(html, url),
    ...microdataCandidates(html),
    ...openGraphCandidates(html, url),
    ...domainCandidates(html, domain),
  ];
  const candidates = raw.map((c) => ({
    ...c,
    title: c.title ?? title,
    imageUrl: c.imageUrl ?? imageUrl,
    currency: c.currency ?? "EUR",
  }));
  return { candidates, title, imageUrl };
}

/**
 * Choose one candidate. With a `source` hint, restrict to that source (falling
 * back to all if the hinted source vanished). With a `target`, pick the nearest
 * price to it — this is what avoids latching onto a struck-out RRP: the nearest
 * to the reference is the one that WAS the price when the product was added.
 */
export function pickCandidate(
  candidates: PriceCandidate[],
  opts: { source?: string | null; target?: number | null } = {},
): PriceCandidate | null {
  let pool = opts.source ? candidates.filter((c) => c.source === opts.source) : candidates;
  if (pool.length === 0) pool = candidates;
  if (pool.length === 0) return null;
  if (opts.target != null) {
    const target = opts.target;
    return pool.reduce((best, c) =>
      Math.abs(c.price - target) < Math.abs(best.price - target) ? c : best,
    );
  }
  return pool[0];
}

/**
 * First-hit convenience wrapper, kept for the preview's primary read. No price
 * found → `price: null` with the title still filled, never a guessed number.
 */
export function extractPrice(html: string, url: string): ExtractedProduct {
  if (!html || html.length === 0) return EMPTY;
  const { candidates, title, imageUrl } = extractPriceCandidates(html, url);
  const first = candidates[0];
  if (!first) return { ...EMPTY, title, imageUrl };
  return {
    price: first.price,
    currency: first.currency ?? "EUR",
    title: first.title ?? title,
    imageUrl: first.imageUrl ?? imageUrl,
    source: first.source,
  };
}
