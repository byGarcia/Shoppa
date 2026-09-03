"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, FetchError } from "@/lib/fetcher";
import { groceryKeys, type ItemDTO } from "@/types";
import { useTranslations } from "next-intl";

type ItemsPayload = { items: ItemDTO[] };

function onMutationError(err: unknown, fallback: string): void {
  toast.error(err instanceof FetchError || err instanceof Error ? err.message : fallback);
}

export function useItems() {
  return useQuery({
    queryKey: groceryKeys.items,
    queryFn: () => fetchJson<ItemsPayload>("/api/items"),
    select: (data) => data.items,
    // Two phones at once (one adds at home, one checks in the store): poll
    // while the list is on screen instead of relying on refocus.
    refetchInterval: 15_000,
  });
}

export function useAddItem() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; storeId: string | null }) =>
      fetchJson<{ item: ItemDTO; reused: boolean }>("/api/items", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onError: (err) => onMutationError(err, t("itemAddFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.items }),
  });
}

export type UpdateItemInput = {
  id: string;
  name?: string;
  checked?: boolean;
  storeId?: string | null;
  categoryId?: string | null;
  quantity?: number | null;
  unit?: string | null;
};

export function useUpdateItem() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: UpdateItemInput) =>
      fetchJson<{ item: ItemDTO }>(`/api/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    // Optimistic checkbox: patch the cache
    // immediately, roll back on error, settle with a refetch.
    onMutate: async (input) => {
      await qc.cancelQueries({ queryKey: groceryKeys.items });
      const previous = qc.getQueryData<ItemsPayload>(groceryKeys.items);
      if (previous) {
        qc.setQueryData<ItemsPayload>(groceryKeys.items, {
          items: previous.items.map((item) =>
            item.id === input.id
              ? {
                  ...item,
                  ...(input.checked !== undefined
                    ? { checked: input.checked, checkedAt: input.checked ? new Date().toISOString() : null }
                    : {}),
                  ...(input.storeId !== undefined ? { storeId: input.storeId } : {}),
                  ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
                  ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
                  ...(input.unit !== undefined ? { unit: input.unit } : {}),
                  ...(input.name !== undefined ? { name: input.name } : {}),
                }
              : item,
          ),
        });
      }
      return { previous };
    },
    onError: (err, _input, ctx) => {
      if (ctx?.previous) qc.setQueryData(groceryKeys.items, ctx.previous);
      onMutationError(err, t("itemUpdateFailed"));
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: groceryKeys.items });
      qc.invalidateQueries({ queryKey: groceryKeys.hints });
    },
  });
}

export function useDeleteItem() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`/api/items/${id}`, { method: "DELETE" }),
    onError: (err) => onMutationError(err, t("itemDeleteFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.items }),
  });
}

export type ClearCheckedInput = { storeId: string | null } | { all: true };

export function useClearChecked() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ClearCheckedInput) =>
      fetchJson<{ deleted: number }>("/api/items/clear-checked", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onError: (err) => onMutationError(err, t("itemClearFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.items }),
  });
}
