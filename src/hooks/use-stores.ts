"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, FetchError } from "@/lib/fetcher";
import { groceryKeys, type StoreDTO } from "@/types";
import { useTranslations } from "next-intl";

function onMutationError(err: unknown, fallback: string): void {
  toast.error(err instanceof FetchError || err instanceof Error ? err.message : fallback);
}

export function useStores() {
  return useQuery({
    queryKey: groceryKeys.stores,
    queryFn: () => fetchJson<{ stores: StoreDTO[] }>("/api/stores"),
    select: (data) => data.stores,
  });
}

export function useCreateStore() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { name: string; color?: string | null; icon?: string | null }) =>
      fetchJson<{ store: StoreDTO }>("/api/stores", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onError: (err) => onMutationError(err, t("storeCreateFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.stores }),
  });
}

export function useUpdateStore() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; name?: string; color?: string | null; icon?: string | null; order?: number }) =>
      fetchJson<{ store: StoreDTO }>(`/api/stores/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onError: (err) => onMutationError(err, t("storeUpdateFailed")),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: groceryKeys.stores });
      qc.invalidateQueries({ queryKey: groceryKeys.items });
    },
  });
}

export function useDeleteStore() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`/api/stores/${id}`, { method: "DELETE" }),
    onError: (err) => onMutationError(err, t("storeDeleteFailed")),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: groceryKeys.stores });
      qc.invalidateQueries({ queryKey: groceryKeys.items });
      qc.invalidateQueries({ queryKey: groceryKeys.hints });
    },
  });
}
