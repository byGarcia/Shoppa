"use client";

import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/settings/page-header";
import { EntityManager } from "@/components/settings/entity-manager";
import { useCategories, useCreateCategory, useUpdateCategory, useDeleteCategory } from "@/hooks/use-categories";
import { useCategoryName } from "@/hooks/use-category-name";

export default function CategoriesPage() {
  const t = useTranslations("settings.categories");
  const categoryName = useCategoryName();
  const { data: categories = [] } = useCategories();
  const create = useCreateCategory();
  const update = useUpdateCategory();
  const remove = useDeleteCategory();

  // The manager edits what it shows: a factory category renders its translation,
  // and renaming it stores exactly the name the person was looking at.
  const named = categories.map((c) => ({ ...c, name: categoryName(c) }));

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-[22px] pb-10 safe-top safe-bottom">
      <PageHeader title={t("title")} />
      <EntityManager
        title={t("section")}
        addLabel={t("add")}
        entities={named}
        onCreate={(body) => create.mutate(body)}
        onUpdate={(body) => update.mutate(body)}
        onDelete={(id) => remove.mutate(id)}
        deleteConfirmText={(name) => t("deleteConfirm", { name })}
      />
    </main>
  );
}
