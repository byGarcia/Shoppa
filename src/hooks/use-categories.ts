"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, FetchError } from "@/lib/fetcher";
import { groceryKeys, type CategoryDTO } from "@/types";
import { useTranslations } from "next-intl";

function onMutationError(err: unknown, fallback: string): void {
  toast.error(err instanceof FetchError || err instanceof Error ? err.message : fallback);
}

export function useCategories() {
  return useQuery({
    queryKey: groceryKeys.categories,
    queryFn: () => fetchJson<{ categories: CategoryDTO[] }>("/api/categories"),
    select: (data) => data.categories,
  });
}

export function useCreateCategory() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; icon?: string | null }) =>
      fetchJson<{ category: CategoryDTO }>("/api/categories", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onError: (err) => onMutationError(err, t("categoryCreateFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.categories }),
  });
}

export function useUpdateCategory() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; icon?: string | null; order?: number }) =>
      fetchJson<{ category: CategoryDTO }>(`/api/categories/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onError: (err) => onMutationError(err, t("categoryUpdateFailed")),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: groceryKeys.categories });
      qc.invalidateQueries({ queryKey: groceryKeys.items });
    },
  });
}

export function useDeleteCategory() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`/api/categories/${id}`, { method: "DELETE" }),
    onError: (err) => onMutationError(err, t("categoryDeleteFailed")),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: groceryKeys.categories });
      qc.invalidateQueries({ queryKey: groceryKeys.items });
      qc.invalidateQueries({ queryKey: groceryKeys.hints });
    },
  });
}
