"use client";

import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/ajustes/page-header";
import { EntityManager } from "@/components/ajustes/entity-manager";
import { useStores, useCreateStore, useUpdateStore, useDeleteStore } from "@/hooks/use-stores";

export default function SupersPage() {
  const t = useTranslations("settings.stores");
  const { data: stores = [] } = useStores();
  const create = useCreateStore();
  const update = useUpdateStore();
  const remove = useDeleteStore();

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-[22px] pb-10 safe-top safe-bottom">
      <PageHeader title={t("title")} />
      <EntityManager
        title={t("section")}
        addLabel={t("add")}
        entities={stores}
        withColor
        onCreate={(body) => create.mutate(body)}
        onUpdate={(body) => update.mutate(body)}
        onDelete={(id) => remove.mutate(id)}
        deleteConfirmText={(name) => t("deleteConfirm", { name })}
      />
    </main>
  );
}
