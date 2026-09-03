"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, FetchError } from "@/lib/fetcher";
import { groceryKeys, type VoiceTokenDTO } from "@/types";
import { useTranslations } from "next-intl";

function onMutationError(err: unknown, fallback: string): void {
  toast.error(err instanceof FetchError || err instanceof Error ? err.message : fallback);
}

export function useVoiceTokens() {
  return useQuery({
    queryKey: groceryKeys.voiceTokens,
    queryFn: () => fetchJson<{ tokens: VoiceTokenDTO[] }>("/api/voice-token"),
    select: (data) => data.tokens,
  });
}

export function useCreateVoiceToken() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { label: string }) =>
      fetchJson<{ token: string; voiceToken: VoiceTokenDTO }>("/api/voice-token", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onError: (err) => onMutationError(err, t("voiceTokenCreateFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.voiceTokens }),
  });
}

export function useDeleteVoiceToken() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`/api/voice-token/${id}`, { method: "DELETE" }),
    onError: (err) => onMutationError(err, t("voiceTokenRevokeFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.voiceTokens }),
  });
}
