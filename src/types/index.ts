// DTO shapes as serialized by the API routes (dates are ISO strings).

export type StoreDTO = {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  order: number;
};

export type CategoryDTO = {
  id: string;
  name: string;
  /**
   * Set only while `name` is still the factory name the installation was seeded
   * with. Non-null means "translate me"; renaming clears it (see the PUT in
   * src/app/api/categories/[id]/route.ts).
   */
  nameKey: string | null;
  icon: string | null;
  order: number;
};

export type ItemDTO = {
  id: string;
  name: string;
  normalizedName: string;
  storeId: string | null;
  categoryId: string | null;
  quantity: number | null;
  unit: string | null;
  checked: boolean;
  source: "APP" | "SIRI";
  createdAt: string;
  checkedAt: string | null;
  /** Learned habitual store for inbox items (null elsewhere). */
  suggestedStoreId: string | null;
};

export type HintDTO = {
  id: string;
  normalizedName: string;
  categoryId: string | null;
  storeHintId: string | null;
  origin: "SEED" | "LEARNED";
  updatedAt: string;
};

export type VoiceTokenDTO = {
  id: string;
  label: string;
  createdAt: string;
  lastUsedAt: string | null;
};

/** Una invitación vista desde Ajustes. Nunca lleva el token ni su hash. */
export type InvitationDTO = {
  id: string;
  state: "pending" | "expired" | "redeemed" | "revoked";
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
  createdByEmail: string;
  redeemedByEmail: string | null;
};

export type PriceSource = "json-ld" | "microdata" | "open-graph" | "domain";

/** One detected price on the page, shown so the user picks the right one. */
export type PriceOption = {
  price: number;
  currency: string;
  source: PriceSource;
};

export type TrackedProductDTO = {
  id: string;
  url: string;
  domain: string;
  title: string;
  imageUrl: string | null;
  /** Price the day it was added: the reference the alert compares against. */
  basePrice: number;
  currency: string;
  currentPrice: number | null;
  lowestPrice: number | null;
  lowestAt: string | null;
  alertActive: boolean;
  isActive: boolean;
  lastCheckedAt: string | null;
  failCount: number;
  lastError: string | null;
  /** Where the reference price was found, so the cron returns there. */
  priceHintSource: string | null;
  createdAt: string;
};

/** TanStack Query key factory — single source for cache invalidation. */
export const groceryKeys = {
  stores: ["stores"] as const,
  categories: ["categories"] as const,
  items: ["items"] as const,
  hints: ["hints"] as const,
  voiceTokens: ["voice-tokens"] as const,
  invitations: ["invitations"] as const,
  prices: ["prices"] as const,
};
