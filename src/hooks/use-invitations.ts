"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { fetchJson, FetchError } from "@/lib/fetcher";
import { groceryKeys, type InvitationDTO } from "@/types";
import { useTranslations } from "next-intl";

function onMutationError(err: unknown, fallback: string): void {
  toast.error(err instanceof FetchError || err instanceof Error ? err.message : fallback);
}

export function useInvitations() {
  return useQuery({
    queryKey: groceryKeys.invitations,
    queryFn: () => fetchJson<{ invitations: InvitationDTO[] }>("/api/invitations"),
    select: (data) => data.invitations,
  });
}

export function useCreateInvitation() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchJson<{ token: string; url: string; expiresAt: string }>("/api/invitations", {
        method: "POST",
      }),
    onError: (err) => onMutationError(err, t("invitationCreateFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.invitations }),
  });
}

export function useRevokeInvitation() {
  const t = useTranslations("toast");
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchJson<{ success: boolean }>(`/api/invitations/${id}`, { method: "DELETE" }),
    onError: (err) => onMutationError(err, t("invitationRevokeFailed")),
    onSettled: () => qc.invalidateQueries({ queryKey: groceryKeys.invitations }),
  });
}
