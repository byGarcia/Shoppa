import { z } from "zod";

/**
 * Zod messages here are catalog keys under `api.*`, not sentences.
 *
 * These schemas are module-level constants — evaluated once, at import — and
 * the catalog is per request. The one place these messages become visible is
 * validateRequest in src/lib/api-utils.ts, which is async and translates them
 * there. Anything Zod itself produces (lengths, types) passes through as-is.
 */

export const storeCreateSchema = z.object({
  name: z.string().trim().min(1, "validation.nameRequired").max(60),
  color: z.string().max(20).nullish(),
  icon: z.string().max(8).nullish(),
});

export const storeUpdateSchema = storeCreateSchema.partial().extend({
  order: z.number().int().min(0).optional(),
});

export const categoryCreateSchema = z.object({
  name: z.string().trim().min(1, "validation.nameRequired").max(60),
  icon: z.string().max(8).nullish(),
});

export const categoryUpdateSchema = categoryCreateSchema.partial().extend({
  order: z.number().int().min(0).optional(),
});

export const itemCreateSchema = z.object({
  name: z.string().trim().min(1, "validation.nameRequired").max(120),
  storeId: z.string().nullish(),
});

export const itemUpdateSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  checked: z.boolean().optional(),
  storeId: z.string().nullable().optional(),
  categoryId: z.string().nullable().optional(),
  quantity: z.number().positive().nullable().optional(),
  unit: z.string().trim().max(20).nullable().optional(),
});

export const clearCheckedSchema = z.union(
  [
    z.object({ storeId: z.string().nullable() }).strict(),
    z.object({ all: z.literal(true) }).strict(),
  ],
  { errorMap: () => ({ message: "validation.clearInvalid" }) },
);

export const ingestSchema = z.object({
  text: z.string().trim().min(1).max(200),
});

export const voiceTokenCreateSchema = z.object({
  label: z.string().trim().min(1, "validation.tokenNameRequired").max(60),
});

export const hintUpdateSchema = z.object({
  categoryId: z.string().nullable().optional(),
  storeHintId: z.string().nullable().optional(),
});

// ============================================================================
// PRICE TRACKING
// ============================================================================

const productUrl = z
  .string()
  .trim()
  .min(1, "validation.urlRequired")
  .max(2000, "validation.urlTooLong");

export const priceUrlSchema = z.object({ url: productUrl });

export const priceCreateSchema = z.object({
  url: productUrl,
  // The reference price. Comes from the preview, or typed by hand when the shop
  // blocked the read — hence a plain number instead of a server-only field.
  basePrice: z.number().positive("validation.pricePositive").max(1_000_000),
  // Truncate rather than reject: shops (Amazon especially) ship titles well
  // over 200 chars, and blocking the save over a long title is user-hostile.
  title: z
    .string()
    .trim()
    .min(1, "validation.productNameRequired")
    .transform((value) => value.slice(0, 200)),
  imageUrl: z.string().trim().max(2000).nullish(),
  currency: z.string().trim().length(3).optional(),
  // Which detected source the reference price came from, so the cron returns
  // there. Client-supplied (the picked candidate); null = generic re-guess.
  hintSource: z.enum(["json-ld", "microdata", "open-graph", "domain"]).nullish(),
});

export const priceUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    isActive: z.boolean().optional(),
    /** Adopt the last read price as the new reference (added at a price peak). */
    rebase: z.literal(true).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, { message: "validation.nothingToUpdate" });
