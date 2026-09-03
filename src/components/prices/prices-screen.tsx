"use client";

import { useState } from "react";
import Link from "next/link";
import { Send } from "lucide-react";
import { useTranslations } from "next-intl";

import { PageHeader } from "@/components/settings/page-header";
import { AddProductForm } from "@/components/prices/add-product-form";
import { ProductCard } from "@/components/prices/product-card";
import {
  usePrices,
  useCheckProduct,
  useDeleteProduct,
  useUpdateProduct,
} from "@/hooks/use-prices";

export function PricesScreen() {
  const t = useTranslations("prices");
  const { data: products = [], isLoading } = usePrices();
  const check = useCheckProduct();
  const update = useUpdateProduct();
  const remove = useDeleteProduct();
  const [checkingId, setCheckingId] = useState<string | null>(null);

  const watching = products.filter((product) => product.isActive).length;

  return (
    <main className="mx-auto min-h-dvh max-w-lg px-[22px] pb-10 safe-top safe-bottom">
      <PageHeader
        title={t("title")}
        subtitle={watching === 0 ? t("emptySubtitle") : t("countSubtitle", { count: watching })}
        back="/"
      />

      <AddProductForm />

      <div className="mt-5 space-y-2.5">
        {products.map((product) => (
          <ProductCard
            key={product.id}
            product={product}
            checking={checkingId === product.id && check.isPending}
            onCheck={() => {
              setCheckingId(product.id);
              check.mutate(product.id, { onSettled: () => setCheckingId(null) });
            }}
            onToggleActive={() => update.mutate({ id: product.id, isActive: !product.isActive })}
            onRebase={() => {
              // Silent state change with real consequences (it decides every
              // future alert), so it gets a confirmation.
              if (!window.confirm(t("rebaseConfirm", { name: product.title }))) return;
              update.mutate({ id: product.id, rebase: true });
            }}
            onDelete={() => {
              if (!window.confirm(t("untrackConfirm", { name: product.title }))) return;
              remove.mutate(product.id);
            }}
          />
        ))}

        {products.length === 0 && !isLoading && (
          <div
            className="flex flex-col items-center gap-2 px-5 py-14 text-center"
            style={{ animation: "rise .4s ease" }}
          >
            <div className="text-[56px] leading-none opacity-90">📉</div>
            <div className="text-[17px] font-bold text-ink">{t("emptyTitle")}</div>
            <p className="max-w-[250px] text-[13px] leading-relaxed text-muted">{t("emptyBody")}</p>
          </div>
        )}
      </div>

      <Link
        href="/settings/telegram"
        className="tap-press mt-6 flex items-center gap-3 rounded-[16px] border border-line bg-surface px-4 py-3.5 shadow-[var(--e1)]"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[11px] bg-chip text-ink-2">
          <Send size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-bold text-ink">{t("telegramTitle")}</span>
          <span className="mt-0.5 block text-[11px] font-medium text-muted">
            {t("telegramSubtitle")}
          </span>
        </span>
      </Link>
    </main>
  );
}
