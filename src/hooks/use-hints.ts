"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, FetchError } from "@/lib/fetcher";
import { groceryKeys, type HintDTO } from "@/types";
import { useTranslations } from "next-intl";

function onMutationError(err: unknown, fallback: string): void {
  toast.error(err instanceof FetchError || err instanceof Error ? err.message : fallback);
}

export function useHints() {
  return useQuery({
    queryKey: groceryKeys.hints,
    queryFn: () => fetchJson<{ hints: HintDTO[] }>("/api/hints"),
    select: (data) => data.hints,
  });
}

export function useUpdateHint() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; categoryId?: string | null; storeHintId?: string | null }) =>
      fetchJson<{ hint: HintDTO }>(`/api/hints/${id}`, {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    onError: (err) => onMutationError(err, t("hintUpdateFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.hints }),
  });
}

export function useDeleteHint() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`/api/hints/${id}`, { method: "DELETE" }),
    onError: (err) => onMutationError(err, t("hintDeleteFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.hints }),
  });
}
