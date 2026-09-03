"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, FetchError } from "@/lib/fetcher";
import { groceryKeys, type PriceOption, type PriceSource, type TrackedProductDTO } from "@/types";
import { useTranslations } from "next-intl";

type ProductsPayload = { products: TrackedProductDTO[] };

export type PreviewDTO = {
  url: string;
  domain: string;
  title: string | null;
  imageUrl: string | null;
  price: number | null;
  currency: string;
  options: PriceOption[];
  error: string | null;
  existingId: string | null;
};

function onMutationError(err: unknown, fallback: string): void {
  toast.error(err instanceof FetchError || err instanceof Error ? err.message : fallback);
}

export function usePrices() {
  return useQuery({
    queryKey: groceryKeys.prices,
    queryFn: () => fetchJson<ProductsPayload>("/api/prices"),
    select: (data) => data.products,
  });
}

/** Reads the pasted URL server-side so the reference price is confirmed by a human. */
export function usePreviewProduct() {
  const t = useTranslations("toast");
  return useMutation({
    mutationFn: (url: string) =>
      fetchJson<{ preview: PreviewDTO }>("/api/prices/preview", {
        method: "POST",
        body: JSON.stringify({ url }),
      }),
    onError: (err) => onMutationError(err, t("priceReadFailed")),
  });
}

export type AddProductInput = {
  url: string;
  basePrice: number;
  title: string;
  imageUrl?: string | null;
  currency?: string;
  hintSource?: PriceSource | null;
};

export function useAddProduct() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: AddProductInput) =>
      fetchJson<{ product: TrackedProductDTO; reused: boolean }>("/api/prices", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: ({ reused, product }) => {
      toast.success(reused ? t("priceAlreadyTracked", { name: product.title }) : t("priceTracked"));
    },
    onError: (err) => onMutationError(err, t("priceSaveFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.prices }),
  });
}

export function useUpdateProduct() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; title?: string; isActive?: boolean; rebase?: true }) =>
      fetchJson<{ product: TrackedProductDTO }>(`/api/prices/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onError: (err) => onMutationError(err, t("priceUpdateFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.prices }),
  });
}

export function useDeleteProduct() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => fetchJson<{ deleted: true }>(`/api/prices/${id}`, { method: "DELETE" }),
    onError: (err) => onMutationError(err, t("priceDeleteFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.prices }),
  });
}

/** Same code path as the morning cron, Telegram rule included. */
export function useCheckProduct() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{
        outcome: { status: string; price?: number; reason?: string; notified?: boolean };
      }>(`/api/prices/${id}/check`, { method: "POST" }),
    onSuccess: ({ outcome }) => {
      if (outcome.status === "failed") toast.error(outcome.reason ?? t("priceUnreadable"));
      else if (outcome.status === "alerted") {
        // Only claim the message went out if it did. This button checks from
        // the server, which does not hold the bot token — the daily run does
        // the notifying, from home.
        toast.success(outcome.notified ? t("priceDropNotified") : t("priceDrop"));
      } else toast.success(t("priceChecked"));
    },
    onError: (err) => onMutationError(err, t("priceCheckFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.prices }),
  });
}

export function useTestTelegram() {
  const t = useTranslations("toast");
  return useMutation({
    mutationFn: () => fetchJson<{ sent: true }>("/api/prices/test-telegram", { method: "POST" }),
    onSuccess: () => toast.success(t("telegramSent")),
    onError: (err) => onMutationError(err, t("telegramFailed")),
  });
}
